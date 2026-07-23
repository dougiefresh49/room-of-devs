/**
 * AudioController — the ONE adapter that owns the phone's <audio> element and
 * the whole playback state machine ported from mobile.html (~1576–3300).
 *
 * Responsibilities (content/delivery-neutral, abortable):
 *   - prime autoplay inside a user gesture (silent WAV unlock)
 *   - static replay (/replay-audio) vs live stream (/live-audio) source select
 *   - phone playback speed (static only; live runs at the baked/base rate)
 *   - live-stream edge reconnect + finalize + a stall watchdog
 *   - Mac↔phone handoff detection, fed by snapshot frames (onSnapshot)
 *   - grant-to-phone pickup of an active phone-routed now-playing frame
 *   - catch-up: sequential playback of a supplied unheard queue
 *   - markListened on completion / 80% progress (via prefs)
 *
 * NO React in here. Components read it through three tiny stores:
 *   - subscribe/getSnapshot  → PlayerSnapshot (the mini player)
 *   - subscribeNotice/getNotice → transient toast text
 *   - onListDirty            → "the replay catalog may have changed, refetch"
 *
 * The Mac→phone / phone→Mac handoff *initiators* (beginMacToPhone /
 * beginPhoneToMac) are ported here but their trigger UI is chunk E (the call /
 * mac-transport surface). onSnapshot runs the detection half every frame so a
 * handoff armed by chunk E completes without further wiring.
 */
import type { NowPlaying, PanelSnapshot } from "@room/protocol";
import { nowPlayingKey } from "@room/room-client";
import { fetchReplayList, postAction, type ReplayEntry } from "../api.js";
import * as prefs from "../prefs.js";

/** 44-byte silent WAV — same primer mobile.html uses to unlock autoplay. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** mp3_44100_128 is CBR 128 kbps → 16 kB/s; byte offset ≈ seconds × this. */
const LIVE_BYTES_PER_SEC = 16000;
const LIVE_STALL_MS = 5000;
const LIVE_MAX_RETRIES = 5;
const HANDOFF_TIMEOUT_MS = 30000;
const TICK_MS = 80;

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "pending-tap";

export interface PlayerSnapshot {
  status: PlayerStatus;
  /** The loaded replay file, or null when idle (strip hidden). */
  file: string | null;
  entry: ReplayEntry | null;
  /** True while streaming a still-growing clip (/live-audio): speed hidden. */
  live: boolean;
  /** Current phone speed multiplier (static playback only). */
  speed: number;
  catchUp: boolean;
  /** "Moving to this phone…" — a Mac→phone handoff is draining. */
  handoffPending: boolean;
  /** spokenText||textPreview — the karaoke/preview source. */
  text: string;
  /** Word timings for the karaoke line, or null (plain text). */
  alignment: NonNullable<ReplayEntry["alignment"]> | null;
  /** (liveBaseSec + audio.currentTime) × 1000 — the karaoke clock. */
  elapsedMs: number;
}

export interface PlayOptions {
  /** Arbitration: when true, refuses while the Mac is speaking. Default true. */
  gated?: boolean;
  /** Stream the growing file via /live-audio instead of /replay-audio. */
  live?: boolean;
  /** Seek to this position (seconds) once metadata loads (handoff). */
  seekSec?: number;
  /** Part of a catch-up run — don't cancel the catch-up queue. */
  fromCatchUp?: boolean;
  /** The now-playing frame backing a live pickup (karaoke/duration source). */
  np?: NowPlaying | null;
}

export interface PlayResult {
  ok: boolean;
  reason?: string;
}

export interface Notice {
  text: string;
  at: number;
}

interface HandoffAwait {
  offsetSec: number;
  sessionId: string;
  startedAt: string;
  character: string;
  name: string;
}

function isNowPlayingActive(np: NowPlaying | null | undefined): np is NowPlaying {
  return !!(np && !np.endedAt && np.kind !== "ack" && np.text);
}

export class AudioController {
  private readonly audio: HTMLAudioElement;

  // playback state
  private status: PlayerStatus = "idle";
  private entry: ReplayEntry | null = null;
  private loadGen = 0;
  private pendingSeekSec = 0;
  private audioUnlocked = false;

  // live-stream state (v2.3)
  private liveMode = false;
  private liveComplete = false;
  private liveBaseSec = 0;
  private liveNp: NowPlaying | null = null;
  private liveRetries = 0;
  private liveProgressWall = 0;

  // catch-up
  private catchUpMode = false;
  private catchUpQueue: ReplayEntry[] = [];

  // snapshot-driven bookkeeping
  private lastFrame: PanelSnapshot | null = null;
  private lastNowPlayingKey: string | null = null;

  // Mac↔phone handoff
  private handoffAwait: HandoffAwait | null = null;
  private handoffTimer: ReturnType<typeof setTimeout> | null = null;

  // stores
  private snapshot: PlayerSnapshot = this.buildSnapshot();
  private notice: Notice | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<() => void>();
  private readonly listDirtyListeners = new Set<() => void>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio();
    this.audio.preload = "auto";
    this.wireAudio();
    // Live stall watchdog (iOS can wedge without firing ended/error).
    this.watchdog = setInterval(() => this.checkLiveStall(), 2000);
  }

  // --- player store (mini player) ------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): PlayerSnapshot => this.snapshot;

  // --- notice store (toast) ------------------------------------------------

  subscribeNotice = (cb: () => void): (() => void) => {
    this.noticeListeners.add(cb);
    return () => this.noticeListeners.delete(cb);
  };
  getNotice = (): Notice | null => this.notice;

  /** "The replay catalog may have changed" — the UI list should refetch. */
  onListDirty(cb: () => void): () => void {
    this.listDirtyListeners.add(cb);
    return () => this.listDirtyListeners.delete(cb);
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.handoffTimer) clearTimeout(this.handoffTimer);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.listeners.clear();
    this.noticeListeners.clear();
    this.listDirtyListeners.clear();
  }

  // --- priming -------------------------------------------------------------

  /** Unlock <audio> inside a user gesture so later SSE-driven play() works. */
  prime(): void {
    if (this.audioUnlocked) return;
    // A loaded track (playing OR paused) means the element already played real
    // audio once — it is unlocked; replacing its src with the silent primer
    // would clobber the clip. Only prime a truly idle element, so the primer's
    // events always fire with entry === null and the handlers ignore them.
    if (this.entry) {
      this.audioUnlocked = true;
      return;
    }
    try {
      this.audio.muted = true;
      this.audio.src = SILENT_WAV;
      const p = this.audio.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          this.audio.pause();
          this.audio.muted = false;
          this.audioUnlocked = true;
        }).catch(() => {
          this.audio.muted = false;
        });
      }
    } catch {
      /* ignore */
    }
  }

  // --- playback ------------------------------------------------------------

  async play(entry: ReplayEntry | null, opts: PlayOptions = {}): Promise<PlayResult> {
    if (!entry?.file) {
      this.notify("No replay");
      return { ok: false, reason: "no-file" };
    }
    const gated = opts.gated ?? true;
    const live = !!opts.live;
    if (gated && this.isMacLive()) {
      this.notify("Mac is speaking — stop it first");
      return { ok: false, reason: "mac-live" };
    }
    if (!opts.fromCatchUp) {
      this.catchUpMode = false;
      this.catchUpQueue = [];
    }
    this.entry = entry;
    this.status = "loading";
    this.liveMode = live;
    this.liveComplete = false;
    this.liveBaseSec = 0;
    this.liveRetries = 0;
    this.liveNp = live ? (opts.np ?? null) : null;
    this.pendingSeekSec =
      Number.isFinite(opts.seekSec) && (opts.seekSec ?? 0) > 0 ? (opts.seekSec as number) : 0;
    const gen = ++this.loadGen;
    this.audio.muted = false;
    const file = encodeURIComponent(entry.file);
    this.audio.src = live
      ? `/live-audio/${file}?v=${Date.now()}`
      : `/replay-audio/${file}`;
    this.applySpeed();
    this.emit();
    try {
      await this.audio.play();
    } catch {
      // Autoplay rejected — but only if this is still the CURRENT load. A rapid
      // track switch aborts the old play() (AbortError) and must not mislabel
      // the new track.
      if (gen === this.loadGen) {
        this.status = "pending-tap";
        this.notify("Ready — tap to play");
        this.emit();
      }
    }
    return { ok: true };
  }

  /** Play/pause the loaded clip. Resume doubles as the pending-tap action. */
  toggle(): void {
    if (this.status === "playing") this.pause();
    else void this.resume();
  }

  pause(): void {
    this.audio.pause();
  }

  async resume(): Promise<void> {
    if (!this.entry) return;
    this.prime();
    try {
      await this.audio.play();
    } catch {
      this.status = "pending-tap";
      this.emit();
    }
  }

  /** × / close: stop phone playback, clear the strip. */
  stop(): void {
    this.stopCatchUp();
    this.clear();
  }

  cycleSpeed(): void {
    prefs.cycleSpeed();
    this.applySpeed();
    this.emit();
  }

  /** Surface a transient toast (App uses it for "No replays yet for X"). */
  announce(text: string): void {
    this.notify(text);
  }

  // --- catch-up ------------------------------------------------------------

  /** Play a supplied (already unheard, already visible) queue in order. */
  async startCatchUp(queue: ReplayEntry[]): Promise<PlayResult> {
    if (this.isMacLive()) {
      this.notify("Mac is speaking — stop it first");
      return { ok: false, reason: "mac-live" };
    }
    if (!queue.length) {
      this.notify("Nothing to catch up");
      return { ok: false, reason: "empty" };
    }
    this.catchUpMode = true;
    this.catchUpQueue = [...queue];
    this.emit();
    const next = this.catchUpQueue.shift();
    if (!next) return { ok: false, reason: "empty" };
    return this.play(next, { fromCatchUp: true });
  }

  stopCatchUp(): void {
    if (!this.catchUpMode && this.catchUpQueue.length === 0) return;
    this.catchUpMode = false;
    this.catchUpQueue = [];
    this.emit();
  }

  // --- snapshot integration (called every frame) ---------------------------

  onSnapshot(snapshot: PanelSnapshot | null): void {
    this.lastFrame = snapshot;
    const np = snapshot?.nowPlaying ?? null;
    // Handoff + finalize don't change nowPlayingKey — check every frame.
    if (this.handoffAwait) this.checkMacToPhoneHandoff();
    this.checkLiveFinalize(np);
    this.enforceArbitration();

    const key = np ? nowPlayingKey(np) : null;
    if (key && key !== this.lastNowPlayingKey) {
      this.lastNowPlayingKey = key;
      // A new frame usually means a new replay entry appeared on disk.
      this.markListDirty();
      // Grant-to-phone: the daemon routed this exact file to the phone.
      if (isNowPlayingActive(np) && np.output === "phone" && np.replayFile) {
        void this.maybePlayGrantToPhone(np);
      }
    } else if (!key) {
      this.lastNowPlayingKey = null;
    }
  }

  // --- grant-to-phone ------------------------------------------------------

  private async maybePlayGrantToPhone(np: NowPlaying): Promise<void> {
    const file = np.replayFile;
    if (!file) return;
    if (this.entry?.file === file && !this.isPhoneIdle()) return; // already on it
    const live = np.synthesisComplete === false;
    let entry: ReplayEntry | null = null;
    // Enriching from the catalog is pointless while live (the .mp3 isn't on
    // disk yet) — synthesize the entry from the frame instead.
    if (!live) {
      try {
        const list = await fetchReplayList();
        entry = list.find((e) => e.file === file) ?? null;
      } catch {
        /* fall through to synthesized entry */
      }
    }
    if (!entry) entry = this.entryFromFrame(file, np);
    await this.play(entry, { gated: false, live, np });
  }

  private entryFromFrame(file: string, np: NowPlaying): ReplayEntry {
    return {
      file,
      sessionId: np.sessionId,
      alignment: np.alignment,
      spokenText: np.text,
      textPreview: np.text,
      rawText: np.rawText,
      playbackRate: np.playbackRate,
    };
  }

  // --- live-stream helpers -------------------------------------------------

  /** The finalize frame keeps the same key — inspect every snapshot. */
  private checkLiveFinalize(np: NowPlaying | null): void {
    if (!this.liveMode || !this.entry || !np || np.replayFile !== this.entry.file) return;
    this.liveNp = np;
    if (np.synthesisComplete && !this.liveComplete) {
      this.liveComplete = true;
      if (np.alignment) this.entry.alignment = np.alignment;
      if (np.playbackRate) this.entry.playbackRate = np.playbackRate;
      this.markListDirty(); // the finalized .mp3 is in the catalog now
      this.emit();
    }
  }

  /** Swap the (unseekable) live stream for the static file at a position. */
  private async switchLiveToStatic(seekSec: number): Promise<void> {
    if (!this.entry?.file) return;
    this.liveMode = false;
    this.liveBaseSec = 0;
    this.pendingSeekSec = Math.max(0, seekSec);
    this.audio.src = `/replay-audio/${encodeURIComponent(this.entry.file)}`;
    this.applySpeed();
    try {
      await this.audio.play();
    } catch {
      this.status = "pending-tap";
      this.notify("Tap to play");
      this.emit();
    }
  }

  /** Live stream hit the growing edge — reconnect from our byte offset. */
  private async reconnectLive(): Promise<void> {
    if (!this.entry?.file || !this.liveMode) return;
    this.liveProgressWall = Date.now();
    this.liveBaseSec += this.audio.currentTime || 0;
    if (this.liveComplete) {
      await this.switchLiveToStatic(this.liveBaseSec);
      return;
    }
    if (this.liveRetries++ >= LIVE_MAX_RETRIES) {
      // No forward progress across several reconnects — stop looping; the
      // finalize frame (or a manual tap) recovers playback.
      this.status = this.audio.paused ? "paused" : this.status;
      this.emit();
      return;
    }
    const fromBytes = Math.floor(this.liveBaseSec * LIVE_BYTES_PER_SEC);
    this.audio.src = `/live-audio/${encodeURIComponent(this.entry.file)}?from=${fromBytes}&v=${Date.now()}`;
    this.applySpeed();
    try {
      await this.audio.play();
    } catch {
      this.status = "pending-tap";
      this.notify("Tap to keep playing");
      this.emit();
    }
  }

  private checkLiveStall(): void {
    if (!this.liveMode || this.liveComplete || this.audio.paused) return;
    if (this.status === "pending-tap") return;
    if (this.liveProgressWall && Date.now() - this.liveProgressWall > LIVE_STALL_MS) {
      this.liveProgressWall = Date.now();
      void this.reconnectLive();
    }
  }

  // --- Mac↔phone handoff (chunk E triggers begin*; detection runs here) -----

  /** Mac speaking → this phone: capture position, stop the Mac, await replay. */
  beginMacToPhone(np: NowPlaying, meta: { character: string; name: string }, offsetSec: number): void {
    this.prime(); // unlock <audio> inside this tap so a later play() works
    this.handoffAwait = {
      offsetSec: Math.max(0, offsetSec),
      sessionId: np.sessionId,
      startedAt: np.startedAt,
      character: meta.character,
      name: meta.name,
    };
    if (this.handoffTimer) clearTimeout(this.handoffTimer);
    this.handoffTimer = setTimeout(() => this.cancelHandoff("Couldn't move playback"), HANDOFF_TIMEOUT_MS);
    this.emit();
    void postAction({ type: "stop" }).then((r) => {
      if (!r) this.cancelHandoff("Couldn't move playback");
    });
  }

  /** This phone → Mac: pause locally, ask the Mac to resume at our offset. */
  beginPhoneToMac(): void {
    if (!this.entry?.file) return;
    this.audio.pause();
    const file = this.entry.file;
    const offsetSec = this.audio.currentTime || 0;
    this.emit();
    void postAction({ type: "play_replay", file, offsetSec }).then((r) => {
      if (!r) this.notify("Mac is busy");
    });
  }

  cancelHandoff(msg?: string): void {
    if (this.handoffTimer) clearTimeout(this.handoffTimer);
    this.handoffTimer = null;
    this.handoffAwait = null;
    this.emit();
    if (msg) this.notify(msg);
  }

  private checkMacToPhoneHandoff(): void {
    const await_ = this.handoffAwait;
    if (!await_) return;
    const np = this.lastFrame?.nowPlaying;
    if (!np || !np.replayFile || !np.endedAt) return;
    const sameSession = !await_.sessionId || np.sessionId === await_.sessionId;
    const sameStart = !await_.startedAt || !np.startedAt || np.startedAt === await_.startedAt;
    if (!sameSession || !sameStart) return;
    const { offsetSec } = await_;
    const file = np.replayFile;
    if (this.handoffTimer) clearTimeout(this.handoffTimer);
    this.handoffTimer = null;
    this.handoffAwait = null;
    void this.playHandoffFile(file, np, offsetSec);
  }

  private async playHandoffFile(file: string, np: NowPlaying, offsetSec: number): Promise<void> {
    let entry: ReplayEntry | null = null;
    try {
      const list = await fetchReplayList();
      entry = list.find((e) => e.file === file) ?? null;
    } catch {
      /* fall through */
    }
    if (!entry) entry = this.entryFromFrame(file, np);
    // Revalidate: a NEWER Mac playback may have started during the fetch —
    // starting the old replay locally would double up audio on both devices.
    const cur = this.lastFrame?.nowPlaying;
    if (cur && !cur.endedAt && cur.startedAt !== np.startedAt && isNowPlayingActive(cur)) {
      this.notify("Mac started speaking — handoff cancelled");
      this.emit();
      return;
    }
    await this.play(entry, { gated: false, seekSec: offsetSec });
  }

  /** Pause the phone plane when the Mac takes the floor (no double audio). */
  private enforceArbitration(): void {
    if (this.isMacLive() && this.entry && !this.audio.paused && !this.audio.ended) {
      this.audio.pause();
    }
  }

  // --- derived predicates --------------------------------------------------

  private isMacLive(): boolean {
    const np = this.lastFrame?.nowPlaying;
    return isNowPlayingActive(np) && np.output !== "phone";
  }

  private isPhoneIdle(): boolean {
    return !this.audio.src || this.audio.paused || this.audio.ended;
  }

  // --- speed ---------------------------------------------------------------

  /**
   * Static playback: base residual rate × the user's speed multiplier. Live
   * streams run at the base rate only — the speed control is hidden during
   * live and the chunked tail can't sustain >1× (phase-5 contract; note that
   * mobile.html applied the multiplier in live mode too — a corrected
   * divergence, logged in decisions-overnight.md).
   */
  private applySpeed(): void {
    const base = this.entry?.playbackRate && this.entry.playbackRate > 0 ? this.entry.playbackRate : 1;
    this.audio.playbackRate = this.liveMode ? base : base * prefs.getSpeed();
  }

  // --- audio element wiring ------------------------------------------------

  private wireAudio(): void {
    this.audio.addEventListener("playing", () => {
      if (!this.entry) return; // silent-primer event — no real track loaded
      this.status = "playing";
      this.startTick();
      this.emit();
    });
    this.audio.addEventListener("pause", () => {
      // Ignore the pause that fires while priming or tearing down / swapping.
      if (!this.entry || this.status === "idle") return;
      if (this.audio.ended) return;
      this.status = "paused";
      this.stopTick();
      this.emit();
    });
    this.audio.addEventListener("ended", () => {
      if (!this.entry) return; // silent-primer event
      // Live stream at the growing edge is NOT track end — reconnect.
      if (this.liveMode && !this.liveComplete) {
        void this.reconnectLive();
        return;
      }
      void this.onTrackEnded();
    });
    this.audio.addEventListener("error", () => {
      if (this.liveMode && !this.liveComplete && this.entry?.file) {
        const gen = this.loadGen;
        const file = this.entry.file;
        setTimeout(() => {
          if (gen === this.loadGen && this.liveMode && !this.liveComplete && this.entry?.file === file) {
            void this.reconnectLive();
          }
        }, 500);
        return;
      }
      this.stopTick();
      if (this.entry) this.status = "paused";
      this.emit();
    });
    this.audio.addEventListener("timeupdate", () => {
      if (!this.entry) return; // silent-primer event
      if (this.liveMode) {
        this.liveProgressWall = Date.now();
        if (this.audio.currentTime > 1) this.liveRetries = 0;
      }
      this.checkListenedProgress();
      // The 80ms tick drives karaoke; timeupdate (~4Hz) only bookkeeps, but
      // emit here too so a paused/seeked frame refreshes the strip promptly.
      if (this.status !== "playing") this.emit();
    });
    this.audio.addEventListener("loadedmetadata", () => {
      if (!this.entry) return; // silent-primer event
      if (this.pendingSeekSec > 0) {
        const target = this.pendingSeekSec;
        this.pendingSeekSec = 0;
        const dur = this.audio.duration;
        const clamped = Number.isFinite(dur) && dur > 0 ? Math.min(target, dur - 0.1) : target;
        try {
          this.audio.currentTime = Math.max(0, clamped);
        } catch {
          /* not seekable */
        }
      }
      this.emit();
    });
  }

  private async onTrackEnded(): Promise<void> {
    const finishedLive = this.liveMode;
    if (finishedLive) {
      // Leave the finalized static file addressable so a re-tap replays it.
      this.liveMode = false;
      this.liveBaseSec = 0;
      this.markListDirty();
    }
    if (this.entry?.file) prefs.markListened(this.entry.file);
    if (this.catchUpMode && this.catchUpQueue.length) {
      const next = this.catchUpQueue.shift();
      if (next) {
        await this.play(next, { fromCatchUp: true });
        return;
      }
    }
    this.catchUpMode = false;
    this.catchUpQueue = [];
    this.clear(); // strip hides when nothing plays (§B1)
  }

  private checkListenedProgress(): void {
    if (!this.entry?.file) return;
    const dur = this.trackDurationSec();
    const cur = this.audio.currentTime || 0;
    if (dur > 0 && cur / dur >= 0.8) prefs.markListened(this.entry.file);
  }

  private trackDurationSec(): number {
    // Live stream: element duration is meaningless (chunked) — estimate from
    // the frame's alignment like the Mac plane does.
    if (this.liveMode && this.liveNp) return this.durationFromFrame(this.liveNp) / 1000;
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) return d;
    const alignment = this.entry?.alignment;
    if (Array.isArray(alignment) && alignment.length) {
      const maxMs = Math.max(0, ...alignment.map((row) => (typeof row[1] === "number" ? row[1] : 0)));
      if (maxMs > 0) return maxMs / 1000 + 0.4;
    }
    return 0;
  }

  private durationFromFrame(np: NowPlaying): number {
    const alignment = np.alignment;
    if (Array.isArray(alignment) && alignment.length) {
      const maxMs = Math.max(0, ...alignment.map((row) => (typeof row[1] === "number" ? row[1] : 0)));
      if (maxMs > 0) return maxMs + 400;
    }
    const cps = np.approxCharsPerSec > 0 ? np.approxCharsPerSec : 15;
    const guess = ((np.text || "").length / cps) * 1000;
    return guess > 0 ? guess : 60000;
  }

  // --- teardown / stores ---------------------------------------------------

  private clear(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.entry = null;
    this.status = "idle";
    this.liveMode = false;
    this.liveComplete = false;
    this.liveBaseSec = 0;
    this.liveNp = null;
    this.liveRetries = 0;
    this.stopTick();
    this.emit();
    this.markListDirty();
  }

  private startTick(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.emit(), TICK_MS);
  }

  private stopTick(): void {
    if (!this.tickTimer) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private buildSnapshot(): PlayerSnapshot {
    const cur = this.audio?.currentTime || 0;
    return {
      status: this.status,
      file: this.entry?.file ?? null,
      entry: this.entry,
      live: this.liveMode,
      speed: prefs.getSpeed(),
      catchUp: this.catchUpMode,
      handoffPending: !!this.handoffAwait,
      text: this.entry ? this.entry.spokenText || this.entry.textPreview || "" : "",
      alignment: this.entry?.alignment ?? null,
      elapsedMs: ((this.liveMode ? this.liveBaseSec : 0) + cur) * 1000,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const cb of this.listeners) cb();
  }

  private notify(text: string): void {
    this.notice = { text, at: Date.now() };
    for (const cb of this.noticeListeners) cb();
  }

  private markListDirty(): void {
    for (const cb of this.listDirtyListeners) cb();
  }
}

/** Module singleton — one <audio>, one state machine for the whole SPA. */
export const audioController = new AudioController();
