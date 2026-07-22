/**
 * Pure lipsync frame + mood logic, moved from main.ts. Everything here is
 * a function of (nowPlaying, audioMs, character, paused) — anchor
 * management (wall clock → audio timeline) lives in engine.ts.
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import { nowPlayingKey } from "@room/room-client";
import {
  expressionsManifest,
  hasMouthClosed,
  hasMouthMid,
  isExprSetReady,
} from "./preload.js";

export type MouthFrame = "idle" | "speaking" | "mouth-mid" | "mouth-closed";
export type MessageMood = "excited" | "confused" | "neutral";
type MoodSegment = { fromWord: number; mood: MessageMood };

export const MOUTH_FLAP_MS = 120;
const MOUTH_GAP_IDLE_MS = 180;
const MOUTH_LAST_WORD_CAP_MS = 900;
const MOUTH_FALLBACK_FLAP_MS = 140;

const EXCITED_RE = /\b(awesome|amazing|perfect|crushed|nailed|shipped it|boom)\b/i;
const CONFUSED_RE = /\b(hmm|not sure|strange|weird|unexpected|can't figure|confused)\b/i;
const ALL_CAPS_WORD_RE = /\b[A-Z]{4,}\b/;

const moodSegmentsBySummary = new Map<string, MoodSegment[]>();

function classifyMood(text: string): MessageMood {
  const bangs = (text.match(/!/g) ?? []).length;
  const ques = (text.match(/\?/g) ?? []).length;
  if (bangs >= 2 || ALL_CAPS_WORD_RE.test(text) || EXCITED_RE.test(text)) return "excited";
  if (ques > bangs || CONFUSED_RE.test(text)) return "confused";
  return "neutral";
}

// Sentence-level mood: character rewrites (Mikey!) are wall-to-wall "!", so a
// whole-message classification pins the excited face for the full duration —
// classify per sentence and map segments onto the word alignment instead.
function classifySentence(sent: string): MessageMood {
  const bangs = (sent.match(/!/g) ?? []).length;
  const ques = (sent.match(/\?/g) ?? []).length;
  if (bangs >= 2 || ALL_CAPS_WORD_RE.test(sent) || EXCITED_RE.test(sent)) return "excited";
  if ((ques > 0 && ques >= bangs) || CONFUSED_RE.test(sent)) return "confused";
  return "neutral";
}

function buildMoodSegments(np: NowPlaying): MoodSegment[] {
  // Segment the SPOKEN text — that's what the word alignment indexes into.
  const text = (np.text ?? "").trim();
  if (!text) return [{ fromWord: 0, mood: "neutral" }];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text];
  const segs: MoodSegment[] = [];
  let word = 0;
  for (const sent of sentences) {
    const n = sent.trim().split(/\s+/).filter(Boolean).length;
    if (!n) continue;
    segs.push({ fromWord: word, mood: classifySentence(sent) });
    word += n;
  }
  return segs.length ? segs : [{ fromWord: 0, mood: classifyMood(text) }];
}

export function moodSegments(np: NowPlaying): MoodSegment[] {
  const key = nowPlayingKey(np);
  let segs = moodSegmentsBySummary.get(key);
  if (!segs) {
    segs = buildMoodSegments(np);
    moodSegmentsBySummary.set(key, segs);
  }
  return segs;
}

/** Keep the segment cache from growing unboundedly across a long session. */
export function pruneMoodSegments(keep: string | null): void {
  if (moodSegmentsBySummary.size < 64) return;
  for (const key of moodSegmentsBySummary.keys()) {
    if (key !== keep) moodSegmentsBySummary.delete(key);
  }
}

function currentWordIndex(np: NowPlaying, audioMs: number): number {
  const al = np.alignment;
  if (!al?.length) return 0;
  let idx = 0;
  for (let i = 0; i < al.length; i++) {
    if (al[i][1] <= audioMs) idx = i;
    else break;
  }
  return idx;
}

function moodAtNow(np: NowPlaying, audioMs: number): MessageMood {
  if (np.kind === "ack") return "neutral";
  const segs = moodSegments(np);
  if (segs.length === 1 || !np.alignment?.length) return segs[0].mood;
  const w = currentWordIndex(np, audioMs);
  let mood = segs[0].mood;
  for (const seg of segs) {
    if (seg.fromWord <= w) mood = seg.mood;
    else break;
  }
  return mood;
}

/** Expression-set prefix for the live non-ack message, or null → neutral frames. */
export function activeExprPrefix(
  character: string,
  np: NowPlaying | null,
  paused: boolean,
  audioMs: number,
): string | null {
  if (!np || np.endedAt || np.kind === "ack") return null;
  // Paused characters drop back to a neutral face — they're waiting, not emoting.
  if (paused) return null;
  const mood = moodAtNow(np, audioMs);
  if (mood === "neutral") return null;
  const expr = expressionsManifest[character]?.[mood];
  if (!expr || !isExprSetReady(character, expr)) return null;
  return expr;
}

export function avatarFrameSrc(character: string, frame: MouthFrame, expr: string | null): string {
  if (frame !== "idle" && expr) {
    return `avatars/tmnt/${character}/${expr}-${frame}.png`;
  }
  return `avatars/tmnt/${character}/${frame}.png`;
}

// Word-gap / paused frame: closed mouth with the TALKING face (idle's relaxed
// eyes strobe against the wide-eyed speaking frames — the "blinking" bug).
export function gapFrame(character: string, expr: string | null): MouthFrame {
  if (expr || hasMouthClosed(character)) return "mouth-closed";
  return "idle";
}

function flapFrame(audioMs: number, periodMs: number, character: string, expr: string | null): MouthFrame {
  const open = Math.floor(audioMs / periodMs) % 2 === 0;
  if (open) return "speaking";
  if (expr || hasMouthMid(character)) return "mouth-mid";
  return gapFrame(character, expr);
}

export function pickMouthFrame(
  audioMs: number,
  alignment: [string, number][] | undefined,
  character: string,
  expr: string | null,
): MouthFrame {
  if (!alignment?.length) {
    return flapFrame(audioMs, MOUTH_FALLBACK_FLAP_MS, character, expr);
  }

  let spanStart = -1;
  let spanEnd = -1;
  for (let i = 0; i < alignment.length; i++) {
    const start = alignment[i][1];
    const end = i + 1 < alignment.length ? alignment[i + 1][1] : start + MOUTH_LAST_WORD_CAP_MS;
    if (audioMs >= start && audioMs < end) {
      spanStart = start;
      spanEnd = end;
      break;
    }
  }
  if (spanStart < 0) return gapFrame(character, expr);

  // Gap ≥ 180ms between word starts → idle after the initial articulation window.
  if (spanEnd - spanStart >= MOUTH_GAP_IDLE_MS && audioMs - spanStart >= MOUTH_GAP_IDLE_MS) {
    return gapFrame(character, expr);
  }
  return flapFrame(audioMs, MOUTH_FLAP_MS, character, expr);
}

/** Frame for an agent that is NOT on the lipsync stage. */
export function staticFrame(agent: AgentView): MouthFrame {
  return agent.state === "speaking" ? "speaking" : "idle";
}
