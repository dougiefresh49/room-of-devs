/**
 * Conversation/sheet state — the chunk-E companion to the AudioController.
 *
 * The controller owns PLAYBACK; this owns the CHAT/CALL SHEET and the small
 * amount of per-frame bookkeeping the sheet needs that isn't audio:
 *
 *   - which session's conversation is open (`sessionId`) and whether the CALL
 *     surface is on top (`callView`);
 *   - `liveClips` per session — client-counted `kind:"live"` nowPlaying frames
 *     this turn (spec §B2 credits chip; named source, never toolCount), reset
 *     on go-live / end-live / reply-send;
 *   - `liveStartedAt` per session — client wall-clock origin for the call timer
 *     (legacy set it on first observed live-on; there is no server since-stamp);
 *   - `ackAts` per session + a transient `ackFlashUntil` — the reply-ack beat
 *     from `phoneAck` (thread chip + call-card flash), page-load-local;
 *   - `threadRev` — bumped when a new NON-live (final) frame lands for the open
 *     session, so the chat view refetches `/thread` (§A1: SSE triggers refetch,
 *     never client-side splicing).
 *
 * App feeds every applied snapshot to `onSnapshot` (right beside
 * audioController.onSnapshot). Components read the derived open-session values
 * through `useConvo()`.
 */
import { useSyncExternalStore } from "react";
import type { PanelSnapshot } from "@room/protocol";
import { nowPlayingKey } from "@room/room-client";
import { liveFreshFingerprint } from "./agent-ext.js";

const ACK_FLASH_MS = 4000;
const LIVE_THREAD_BUMP_MS = 2500;

export type LiveTransition = "idle" | "starting" | "ending";
export type MuteTransition = "idle" | "muting" | "unmuting";

/** A reply accepted by the daemon but not yet visible in `/thread`. */
export interface PendingReply {
  text: string;
  /** Client wall-clock ms when the send was accepted. */
  at: number;
}

/** Injected replies take seconds to land in the transcript (tmux typing / T3
 *  turn adoption). Pending echoes older than this are dropped as failed. */
const PENDING_REPLY_TTL_MS = 3 * 60_000;

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface ConvoSnapshot {
  /** Open conversation session id, or null when the sheet is closed. */
  sessionId: string | null;
  /** True = call surface on top; only meaningful while the session is live. */
  callView: boolean;
  /** Live clips counted this turn for the OPEN session. */
  liveClips: number;
  /** Call-timer origin (ms) for the OPEN session, or null. */
  liveStartedAt: number | null;
  /** Ack-event timestamps for the OPEN session (thread chips). */
  ackAts: readonly string[];
  /** Wall-clock (ms) until which the call card shows the ack beat, or null. */
  ackFlashUntil: number | null;
  /** Bumps to force a `/thread` refetch for the open session. */
  threadRev: number;
  /**
   * Optimistic echoes for the OPEN session: replies the daemon accepted that
   * the transcript hasn't shown yet. The sheet reconciles these against fresh
   * `/thread` items (drop on match or TTL) — the one deliberate exception to
   * "nothing is spliced client-side", bounded and self-clearing.
   */
  pendingReplies: readonly PendingReply[];
  /**
   * In-flight set_live transition for the OPEN session. While not "idle" every
   * Go-live / End-live control is disabled and further dispatches are ignored,
   * so a double-tap (or an opposite tap before the first resolves) can't post
   * duplicate/conflicting set_live commands.
   */
  liveTransition: LiveTransition;
  /**
   * In-flight set_live_mute transition for the OPEN session. While not "idle"
   * the mute control is disabled and shows the target state.
   */
  muteTransition: MuteTransition;
}

class ConvoStore {
  private sessionId: string | null = null;
  private callView = false;
  private readonly liveClips = new Map<string, number>();
  private readonly liveStartedAt = new Map<string, number>();
  private readonly ackEvents = new Map<string, string[]>();
  private ackFlash: { sessionId: string; until: number } | null = null;
  private threadRev = 0;
  /** In-flight set_live transition per session + its monotonic token. */
  private readonly liveTransitions = new Map<string, LiveTransition>();
  private readonly liveTxnToken = new Map<string, number>();
  /** In-flight set_live_mute transition per session + its monotonic token. */
  private readonly muteTransitions = new Map<string, MuteTransition>();
  private readonly muteTxnToken = new Map<string, number>();
  /** Live text-freshness tracking for throttled threadRev bumps. */
  private readonly liveFreshTrack = new Map<string, string>();
  /** Optimistic reply echoes per session, pruned on transcript match/TTL. */
  private readonly pendingReplies = new Map<string, PendingReply[]>();
  /** Open agent's last observed state — transitions trigger a /thread refetch. */
  private openAgentState: string | null = null;
  /** Sessions whose live-muted mode we auto-started on a chat send. */
  private readonly autoLiveSessions = new Set<string>();
  private lastLiveThreadBumpAt = 0;
  private liveThreadBumpTimer: ReturnType<typeof setTimeout> | null = null;

  // per-frame dedup
  private lastNowPlayingKey: string | null = null;
  private lastAckAt: string | null = null;

  private snapshot: ConvoSnapshot = this.build();
  private readonly listeners = new Set<() => void>();

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): ConvoSnapshot => this.snapshot;

  // --- sheet open / close / slide -----------------------------------------

  /** Open a session's conversation. `asCall` starts on the call surface. */
  open(sessionId: string, opts: { asCall?: boolean } = {}): void {
    this.sessionId = sessionId;
    this.callView = !!opts.asCall;
    this.openAgentState = null;
    this.emit();
  }

  close(): void {
    this.sessionId = null;
    this.callView = false;
    this.openAgentState = null;
    this.clearLiveThreadBumpTimer();
    this.emit();
  }

  /**
   * Auto-live bookkeeping: live-muted sessions we started implicitly on a
   * chat send (so responses stream in as text). Cleared when the user takes
   * ownership (manual Go live / End live / unmute) — the sheet's close
   * handler only ends live for sessions still marked here.
   */
  markAutoLive(sessionId: string): void {
    this.autoLiveSessions.add(sessionId);
  }
  clearAutoLive(sessionId: string): void {
    this.autoLiveSessions.delete(sessionId);
  }
  isAutoLive(sessionId: string): boolean {
    return this.autoLiveSessions.has(sessionId);
  }

  setCallView(on: boolean): void {
    if (this.callView === on) return;
    this.callView = on;
    this.emit();
  }

  // --- live bookkeeping ----------------------------------------------------

  /**
   * go-live: zero the clip count + show the call surface. The timer ORIGIN is
   * NOT set here — it's snapshot-driven (set when the daemon confirms live-on),
   * so the optimistic pre-confirm window can't be mistaken for a live-off
   * transition by onSnapshot. The timer reads 0:00 for that sub-second gap.
   */
  beginLive(sessionId: string): void {
    this.liveClips.set(sessionId, 0);
    this.callView = true;
    this.emit();
  }

  /**
   * end-live: slide back to chat immediately + zero the clip count. The timer
   * origin is snapshot-driven and clears when the daemon confirms live-off.
   */
  endLive(sessionId: string): void {
    this.liveClips.set(sessionId, 0);
    this.callView = false;
    this.emit();
  }

  /** reply sent (a genuine user prompt) → reset the live clip counter. */
  resetLiveClips(sessionId: string): void {
    if ((this.liveClips.get(sessionId) ?? 0) === 0) return;
    this.liveClips.set(sessionId, 0);
    this.emit();
  }

  /** Force a `/thread` refetch (used right after a reply is accepted). */
  /** Record an accepted reply so the chat shows it before the transcript does. */
  addPendingReply(sessionId: string, text: string): void {
    const list = this.pendingReplies.get(sessionId) ?? [];
    list.push({ text, at: Date.now() });
    this.pendingReplies.set(sessionId, list);
    if (sessionId === this.sessionId) this.emit();
  }

  /**
   * Drop pending echoes the transcript now covers (a user item whose
   * normalized text contains the echo's — tmux injection may wrap the text)
   * plus any past TTL. Called by the sheet whenever fresh `/thread` items land.
   */
  reconcilePendingReplies(
    sessionId: string,
    items: ReadonlyArray<{ role: string; text: string }>,
  ): void {
    const list = this.pendingReplies.get(sessionId);
    if (!list?.length) return;
    const userTexts = items.filter((it) => it.role === "user").map((it) => normalizeWs(it.text));
    const cutoff = Date.now() - PENDING_REPLY_TTL_MS;
    const next = list.filter((p) => {
      if (p.at < cutoff) return false;
      const needle = normalizeWs(p.text);
      return !userTexts.some((t) => t.includes(needle));
    });
    if (next.length === list.length) return;
    if (next.length) this.pendingReplies.set(sessionId, next);
    else this.pendingReplies.delete(sessionId);
    if (sessionId === this.sessionId) this.emit();
  }

  bumpThread(): void {
    this.threadRev++;
    this.emit();
  }

  // --- set_live transition guard ------------------------------------------

  /** Current in-flight live transition for a session. */
  liveTransitionOf(sessionId: string): LiveTransition {
    return this.liveTransitions.get(sessionId) ?? "idle";
  }

  /**
   * Begin a set_live transition; returns null when one is already in flight
   * (caller must abort — the control is also disabled in the UI). Otherwise
   * returns a monotonic token the caller passes back to `endLiveTransition` so
   * a stale completion can't clear a newer transition.
   */
  beginLiveTransition(sessionId: string, kind: "starting" | "ending"): number | null {
    if ((this.liveTransitions.get(sessionId) ?? "idle") !== "idle") return null;
    const token = (this.liveTxnToken.get(sessionId) ?? 0) + 1;
    this.liveTxnToken.set(sessionId, token);
    this.liveTransitions.set(sessionId, kind);
    this.emit();
    return token;
  }

  /** True while `token` is still the current transition for the session. */
  isLiveTransitionCurrent(sessionId: string, token: number): boolean {
    return this.liveTxnToken.get(sessionId) === token;
  }

  /** Settle a transition — no-op if a newer one has superseded this token. */
  endLiveTransition(sessionId: string, token: number): void {
    if (this.liveTxnToken.get(sessionId) !== token) return;
    if ((this.liveTransitions.get(sessionId) ?? "idle") === "idle") return;
    this.liveTransitions.set(sessionId, "idle");
    this.emit();
  }

  // --- set_live_mute transition guard ------------------------------------

  muteTransitionOf(sessionId: string): MuteTransition {
    return this.muteTransitions.get(sessionId) ?? "idle";
  }

  beginMuteTransition(sessionId: string, muted: boolean): number | null {
    if ((this.muteTransitions.get(sessionId) ?? "idle") !== "idle") return null;
    const token = (this.muteTxnToken.get(sessionId) ?? 0) + 1;
    this.muteTxnToken.set(sessionId, token);
    this.muteTransitions.set(sessionId, muted ? "muting" : "unmuting");
    this.emit();
    return token;
  }

  isMuteTransitionCurrent(sessionId: string, token: number): boolean {
    return this.muteTxnToken.get(sessionId) === token;
  }

  endMuteTransition(sessionId: string, token: number): void {
    if (this.muteTxnToken.get(sessionId) !== token) return;
    if ((this.muteTransitions.get(sessionId) ?? "idle") === "idle") return;
    this.muteTransitions.set(sessionId, "idle");
    this.emit();
  }

  private clearLiveThreadBumpTimer(): void {
    if (this.liveThreadBumpTimer !== null) {
      clearTimeout(this.liveThreadBumpTimer);
      this.liveThreadBumpTimer = null;
    }
  }

  private scheduleLiveThreadBump(): void {
    const now = Date.now();
    const since = now - this.lastLiveThreadBumpAt;
    if (since >= LIVE_THREAD_BUMP_MS) {
      this.flushLiveThreadBump();
      return;
    }
    if (this.liveThreadBumpTimer !== null) return;
    this.liveThreadBumpTimer = setTimeout(() => {
      this.liveThreadBumpTimer = null;
      this.flushLiveThreadBump();
    }, LIVE_THREAD_BUMP_MS - since);
  }

  private flushLiveThreadBump(): void {
    this.lastLiveThreadBumpAt = Date.now();
    this.threadRev++;
    this.emit();
  }

  // --- snapshot integration (called every applied frame) ------------------

  onSnapshot(snap: PanelSnapshot | null): void {
    let dirty = false;
    const now = Date.now();

    // liveStartedAt tracking: set on first observed live-on, clear on off.
    // A genuine on→off for the OPEN session also forces the sheet back to chat
    // (server auto-off / external end), mirroring legacy's `if (!liveOn)
    // callViewOpen = false`.
    for (const agent of snap?.agents ?? []) {
      const on = !!agent.live?.on;
      const has = this.liveStartedAt.has(agent.sessionId);
      if (on && !has) {
        this.liveStartedAt.set(agent.sessionId, now);
        dirty ||= agent.sessionId === this.sessionId;
      } else if (!on && has) {
        this.liveStartedAt.delete(agent.sessionId);
        if (agent.sessionId === this.sessionId && this.callView) this.callView = false;
        dirty ||= agent.sessionId === this.sessionId;
      }
    }

    // New now-playing frame → count live clips / trigger thread refetch.
    const np = snap?.nowPlaying ?? null;
    const key = np ? nowPlayingKey(np) : null;
    if (key && key !== this.lastNowPlayingKey) {
      this.lastNowPlayingKey = key;
      if (np && np.sessionId) {
        if (np.kind === "live") {
          this.liveClips.set(np.sessionId, (this.liveClips.get(np.sessionId) ?? 0) + 1);
          dirty ||= np.sessionId === this.sessionId;
        } else {
          // Non-live (final) frame → /thread is the source of truth, refetch.
          if (np.sessionId === this.sessionId) {
            this.threadRev++;
            dirty = true;
          }
        }
      }
    } else if (!key) {
      this.lastNowPlayingKey = null;
    }

    // Live text freshness: while the open session is live-on, bump threadRev on
    // intermediate activity (throttled trailing — never drop the last change).
    const openSid = this.sessionId;
    if (openSid && snap) {
      const openAgent = snap.agents.find((a) => a.sessionId === openSid);
      // State transitions (working → hand_raised/idle etc.) refetch even
      // WITHOUT live: in announce mode a final never produces a now-playing
      // frame, so this is the only signal that the response landed — without
      // it the chat stays stale and a pending echo reads "sending…" forever.
      if (openAgent && openAgent.state !== this.openAgentState) {
        if (this.openAgentState !== null) {
          this.threadRev++;
          dirty = true;
        }
        this.openAgentState = openAgent.state;
      }
      if (openAgent?.live?.on) {
        const fp = liveFreshFingerprint(openAgent);
        const prev = this.liveFreshTrack.get(openSid);
        if (prev !== undefined && prev !== fp) {
          this.liveFreshTrack.set(openSid, fp);
          this.scheduleLiveThreadBump();
        } else if (prev === undefined) {
          this.liveFreshTrack.set(openSid, fp);
        }
      } else {
        this.liveFreshTrack.delete(openSid);
      }
    }

    // Reply ack routed to this phone → beat + thread chip (page-load-local).
    const ack = snap?.phoneAck ?? null;
    if (ack && ack.at && ack.at !== this.lastAckAt) {
      this.lastAckAt = ack.at;
      this.ackFlash = { sessionId: ack.sessionId, until: now + ACK_FLASH_MS };
      const list = this.ackEvents.get(ack.sessionId) ?? [];
      list.push(ack.at);
      this.ackEvents.set(ack.sessionId, list);
      dirty ||= ack.sessionId === this.sessionId;
    }

    if (dirty) this.emit();
  }

  // --- derive --------------------------------------------------------------

  private build(): ConvoSnapshot {
    const sid = this.sessionId;
    const flash =
      sid && this.ackFlash && this.ackFlash.sessionId === sid ? this.ackFlash.until : null;
    return {
      sessionId: sid,
      callView: this.callView,
      liveClips: sid ? (this.liveClips.get(sid) ?? 0) : 0,
      liveStartedAt: sid ? (this.liveStartedAt.get(sid) ?? null) : null,
      ackAts: sid ? (this.ackEvents.get(sid) ?? []) : [],
      ackFlashUntil: flash,
      threadRev: this.threadRev,
      pendingReplies: sid ? (this.pendingReplies.get(sid) ?? []) : [],
      liveTransition: sid ? (this.liveTransitions.get(sid) ?? "idle") : "idle",
      muteTransition: sid ? (this.muteTransitions.get(sid) ?? "idle") : "idle",
    };
  }

  private emit(): void {
    this.snapshot = this.build();
    for (const cb of this.listeners) cb();
  }
}

/** Module singleton — one open sheet for the whole SPA. */
export const convo = new ConvoStore();

/** Derived open-session conversation state for React components. */
export function useConvo(): ConvoSnapshot {
  return useSyncExternalStore(convo.subscribe, convo.getSnapshot);
}
