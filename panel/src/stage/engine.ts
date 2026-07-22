/**
 * The stage engine: ONE rAF loop driving lipsync + blink by direct <img>
 * mutation, over a ref registry populated by AvatarImg. React renders a
 * neutral initial frame once; after registration the engine owns src.
 * Avatar frame-flipping NEVER goes through React renders (spec hard rule).
 *
 * Timing model (Sol #10): rAF is the primary scheduler; a 70ms watchdog
 * interval runs the same tick when rAF stalls >150ms while the document is
 * visible (non-key NSPanel over a fullscreen Space is unproven territory
 * for WebKit rAF). Hidden window → both stop doing visible work; on wake,
 * expired blink windows restore and reschedule from now (no replay).
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import type { RoomClient } from "@room/room-client";
import { isPhoneRoutedFrame } from "@room/room-client";
import {
  activeExprPrefix,
  avatarFrameSrc,
  gapFrame,
  moodSegments,
  pickMouthFrame,
  pruneMoodSegments,
  staticFrame,
  type MouthFrame,
} from "./frames.js";
import { blinkFrameSrc, hasBlink } from "./preload.js";
import { nowPlayingKey } from "@room/room-client";

const BLINK_MS = 130;
const BLINK_MIN_GAP_MS = 3500;
const BLINK_MAX_GAP_MS = 7000;
const BLINK_TICK_MS = 100;
const WATCHDOG_MS = 70;
const RAF_STALL_MS = 150;

interface Registration {
  el: HTMLImageElement;
  character: string;
}

interface EngineState {
  connected: boolean;
  agents: AgentView[];
  nowPlaying: NowPlaying | null;
  paused: boolean;
}

const registry = new Map<string, Set<Registration>>();

let client: RoomClient | null = null;
let unsubscribe: (() => void) | null = null;
let disposed = false;

let engineState: EngineState = { connected: false, agents: [], nowPlaying: null, paused: false };

/** Wall clock → alignment timeline anchor, keyed by message identity. */
let anchor: { key: string; t0: number } | null = null;
let pausedAtWall = 0;

const blinkUntil = new Map<string, number>();
const nextBlinkAt = new Map<string, number>();

let rafId: number | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let lastRafAt = 0;
let lastBlinkCheckAt = 0;

// ── Stage predicates (renamed from isSessionLive/isLipsyncActive — that
// vocabulary now belongs to daemon live mode) ─────────────────────────

function stageNowPlaying(): NowPlaying | null {
  const { connected, nowPlaying, agents } = engineState;
  if (!connected || !nowPlaying || nowPlaying.endedAt) return null;
  if (isPhoneRoutedFrame(nowPlaying)) return null;
  if (!agents.some((a) => a.sessionId === nowPlaying.sessionId)) return null;
  return nowPlaying;
}

/** Mac lipsync stage is active for this session (acks included). */
export function isStageActive(sessionId?: string): boolean {
  const np = stageNowPlaying();
  if (!np) return false;
  return sessionId == null || np.sessionId === sessionId;
}

/** Stage-active AND worth visual real estate (not an ack). */
export function isSpotlightWorthy(sessionId?: string): boolean {
  return isStageActive(sessionId) && stageNowPlaying()?.kind !== "ack";
}

// ── Frame application ─────────────────────────────────────────────────

/** Single source of truth: wall clock → alignment timeline (atempo-aware). */
function alignmentAudioMs(np: NowPlaying): number {
  const key = `${np.sessionId}:${np.startedAt}`;
  if (!anchor || anchor.key !== key) {
    anchor = { key, t0: performance.now() };
  }
  const wallMs = performance.now() - anchor.t0;
  const rate = typeof np.playbackRate === "number" && np.playbackRate > 0 ? np.playbackRate : 1;
  // atempo speeds content vs wall — multiply (not divide) so lookups track heard audio.
  return wallMs * rate;
}

function stageFrame(np: NowPlaying, character: string): { frame: MouthFrame; expr: string | null } {
  const audioMs = alignmentAudioMs(np);
  const expr = activeExprPrefix(character, np, engineState.paused, audioMs);
  if (engineState.paused) return { frame: gapFrame(character, expr), expr };
  return { frame: pickMouthFrame(audioMs, np.alignment, character, expr), expr };
}

function setSrc(reg: Registration, src: string) {
  if (reg.el.getAttribute("src") !== src) reg.el.src = src;
}

/** Current correct src for a session (stage, static, or blink-frozen). */
function applyFrames(sessionId: string, regs: Set<Registration>, now: number) {
  // Don't stomp an in-flight blink (paused/gap blinks are intentional).
  const until = blinkUntil.get(sessionId);
  if (until != null && now < until) return;

  const np = stageNowPlaying();
  if (np && np.sessionId === sessionId) {
    for (const reg of regs) {
      const { frame, expr } = stageFrame(np, reg.character);
      setSrc(reg, avatarFrameSrc(reg.character, frame, expr));
    }
    return;
  }

  const agent = engineState.agents.find((a) => a.sessionId === sessionId);
  if (!agent) return;
  const frame = staticFrame(agent);
  for (const reg of regs) {
    setSrc(reg, avatarFrameSrc(reg.character, frame, null));
  }
}

/** Mid-word / open-mouth flaps — blink would strobe against speaking frames. */
function isMidWordMouth(sessionId: string, character: string): boolean {
  const np = stageNowPlaying();
  if (!np || np.sessionId !== sessionId) return false;
  const { frame } = stageFrame(np, character);
  return frame === "speaking" || frame === "mouth-mid";
}

function randomBlinkGapMs(): number {
  return BLINK_MIN_GAP_MS + Math.random() * (BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS);
}

function scheduleNextBlink(sessionId: string, from: number) {
  nextBlinkAt.set(sessionId, from + randomBlinkGapMs());
}

function blinkTick(now: number) {
  // End expired blinks (incl. ones that expired long ago while hidden —
  // restore and reschedule from now, never replay).
  for (const sessionId of [...blinkUntil.keys()]) {
    const regs = registry.get(sessionId);
    if (!regs || regs.size === 0) {
      blinkUntil.delete(sessionId);
      continue;
    }
    const until = blinkUntil.get(sessionId)!;
    if (now < until) continue;
    blinkUntil.delete(sessionId);
    scheduleNextBlink(sessionId, now);
    applyFrames(sessionId, regs, now);
  }

  // Start due blinks.
  for (const [sessionId, regs] of registry) {
    if (regs.size === 0 || blinkUntil.has(sessionId)) continue;
    const agent = engineState.agents.find((a) => a.sessionId === sessionId);
    if (!agent) continue;
    const character = (agent.character ?? "default").toLowerCase();
    if (!hasBlink(character)) continue;
    if (!nextBlinkAt.has(sessionId)) scheduleNextBlink(sessionId, now);
    if (now < nextBlinkAt.get(sessionId)!) continue;
    if (isMidWordMouth(sessionId, character)) {
      // Defer — don't burn the interval while the mouth is open.
      nextBlinkAt.set(sessionId, now + 200);
      continue;
    }
    blinkUntil.set(sessionId, now + BLINK_MS);
    for (const reg of regs) setSrc(reg, blinkFrameSrc(reg.character));
  }

  // Drop schedules for agents that left the room/registry.
  for (const sessionId of [...nextBlinkAt.keys()]) {
    const stillVisible = (registry.get(sessionId)?.size ?? 0) > 0;
    const stillInRoom = engineState.agents.some((a) => a.sessionId === sessionId);
    if (!stillVisible && !stillInRoom) {
      nextBlinkAt.delete(sessionId);
      blinkUntil.delete(sessionId);
    }
  }
}

function tick() {
  if (disposed) return;
  const now = performance.now();

  // Lipsync: only the stage session animates per-tick; everyone else's
  // frame is state-driven and applied on store changes/blink restore.
  const np = stageNowPlaying();
  if (np) {
    const regs = registry.get(np.sessionId);
    if (regs) applyFrames(np.sessionId, regs, now);
  }

  // Blink at ~100ms granularity (legacy cadence), not per frame.
  if (now - lastBlinkCheckAt >= BLINK_TICK_MS) {
    lastBlinkCheckAt = now;
    blinkTick(now);
  }
}

function rafLoop() {
  if (disposed) return;
  lastRafAt = performance.now();
  tick();
  rafId = requestAnimationFrame(rafLoop);
}

// ── Store integration ─────────────────────────────────────────────────

function onStoreChange() {
  if (!client) return;
  const st = client.getState();
  const snap = st.snapshot;
  const prevPaused = engineState.paused;

  engineState = {
    connected: st.connected,
    agents: snap?.agents ?? [],
    nowPlaying: snap?.nowPlaying ?? null,
    paused: snap?.paused === true,
  };

  // SIGSTOP froze the audio but not the wall clock — push the anchor
  // forward by the paused span so the mouth stays in sync on resume.
  if (engineState.paused !== prevPaused) {
    if (engineState.paused) {
      pausedAtWall = performance.now();
    } else if (anchor && pausedAtWall) {
      anchor.t0 += performance.now() - pausedAtWall;
    }
    pausedAtWall = engineState.paused ? pausedAtWall : 0;
  }

  const np = stageNowPlaying();
  if (np && np.kind !== "ack" && !isPhoneRoutedFrame(np)) {
    moodSegments(np); // warm the per-message segment cache
    pruneMoodSegments(nowPlayingKey(np));
  }
  if (!np) anchor = null;

  // Prune blink state for sessions that left the SNAPSHOT (the last-ref
  // path in registerAvatar covers the other direction — Sol: OR, not AND).
  for (const sessionId of [...nextBlinkAt.keys()]) {
    if (!engineState.agents.some((a) => a.sessionId === sessionId)) {
      nextBlinkAt.delete(sessionId);
      blinkUntil.delete(sessionId);
    }
  }

  // Re-apply state-driven frames for everyone off stage (speaking↔idle
  // transitions come from snapshots, not the rAF loop).
  const now = performance.now();
  for (const [sessionId, regs] of registry) {
    if (regs.size) applyFrames(sessionId, regs, now);
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export function initStageEngine(c: RoomClient): void {
  client = c;
  disposed = false;
  unsubscribe = c.subscribe(onStoreChange);
  onStoreChange();
  rafId = requestAnimationFrame(rafLoop);
  watchdog = setInterval(() => {
    if (disposed || document.visibilityState !== "visible") return;
    if (performance.now() - lastRafAt > RAF_STALL_MS) tick();
  }, WATCHDOG_MS);
}

export function disposeStageEngine(): void {
  disposed = true;
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  unsubscribe?.();
  unsubscribe = null;
  registry.clear();
  blinkUntil.clear();
  nextBlinkAt.clear();
  anchor = null;
}

/**
 * Register an avatar <img>. The engine immediately applies the CURRENT
 * frame (React only rendered the neutral initial src — Sol #12). Returns
 * the unregister cleanup for the ref callback.
 */
export function registerAvatar(
  sessionId: string,
  character: string,
  el: HTMLImageElement,
): () => void {
  let regs = registry.get(sessionId);
  if (!regs) {
    regs = new Set();
    registry.set(sessionId, regs);
  }
  const reg: Registration = { el, character };
  regs.add(reg);
  const now = performance.now();
  const until = blinkUntil.get(sessionId);
  if (until != null && now < until) {
    // Mid-blink registration: applyFrames would skip (blink guard) and
    // leave the img src-less — show the blink frame; restore comes with
    // the blink end.
    setSrc(reg, blinkFrameSrc(character));
  } else {
    applyFrames(sessionId, new Set([reg]), now);
  }
  return () => {
    const set = registry.get(sessionId);
    if (!set) return;
    set.delete(reg);
    if (set.size === 0) {
      registry.delete(sessionId);
      // Last ref gone → prune per-session blink state (Sol #11).
      blinkUntil.delete(sessionId);
      nextBlinkAt.delete(sessionId);
    }
  };
}
