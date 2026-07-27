/**
 * Transcript service — bounded parsing of Claude Code session transcripts
 * (<sessionId>.jsonl under ~/.claude/projects) with separate projections.
 *
 * Lives outside mobile-http on purpose: the HTTP layer was the wrong owner
 * for parsing, and the current UI projection deliberately drops tool_result
 * blocks — a limitation of THAT projection, not of the service. The future
 * conversational layer (docs/design-conversational-layer.md) will add a
 * redacted tool-output projection here for factual Q&A ("what was that URL")
 * without touching the entry parser.
 */
import { openSync, readSync, closeSync, fstatSync } from "fs";
import { findTranscript } from "../live-tail.js";

/** Parse no more than this many bytes from the tail of a transcript — very
 *  long sessions (100MB+ observed) must not stall a snapshot-adjacent path. */
const MAX_PARSE_BYTES = 8 * 1024 * 1024;

export interface TranscriptEntry {
  role: "user" | "agent";
  /** Text blocks only in this projection; truncated to 2000 chars each. */
  text: string;
  at: string | null;
}

export interface ThreadItem extends TranscriptEntry {
  /** Agent items: true when this was the last agent message of its turn. */
  final?: boolean;
}

/** Raw JSONL lines → typed entries. Sidechains and tool results excluded. */
function parseEntries(raw: string): TranscriptEntry[] {
  const items: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // tail cut may truncate the first line — skip partials
    }
    if (entry?.isSidechain) continue;
    const content = entry?.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    const at = typeof entry?.timestamp === "string" ? entry.timestamp : null;
    if (entry?.type === "user") {
      if (entry.toolUseResult !== undefined || blocks.some((b: any) => b?.type === "tool_result")) {
        continue;
      }
      const text = (
        typeof content === "string"
          ? content
          : blocks
              .filter((b: any) => b?.type === "text" && typeof b.text === "string")
              .map((b: any) => b.text)
              .join("\n")
      ).trim();
      if (!text || text.startsWith("<task-notification")) continue;
      items.push({ role: "user", text: text.slice(0, 2000), at });
    } else if (entry?.type === "assistant") {
      for (const block of blocks) {
        if (block?.type !== "text" || typeof block.text !== "string" || !block.text.trim()) {
          continue;
        }
        items.push({ role: "agent", text: block.text.trim().slice(0, 2000), at });
      }
    }
  }
  return items;
}

/** Read (the bounded tail of) a session transcript; null = no transcript.
 *  Reads AT MOST MAX_PARSE_BYTES from disk — a 100MB transcript must not be
 *  loaded whole just to slice its tail. */
function readTranscriptRaw(sessionId: string): string | null {
  const transcript = findTranscript(sessionId);
  if (!transcript) return null;
  let fd: number | null = null;
  try {
    fd = openSync(transcript, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, MAX_PARSE_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString("utf-8");
    if (size <= MAX_PARSE_BYTES) return text;
    // Tail cut on a line boundary; parseEntries skips a torn first line.
    const nl = text.indexOf("\n");
    return nl >= 0 ? text.slice(nl + 1) : text;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * UI thread projection (mobile chat view): user + agent text messages, with
 * `final` marking the last agent message before each user turn (and the
 * trailing one). Identical output to the old mobile-http transcriptThread.
 */
export function transcriptThread(sessionId: string): ThreadItem[] | null {
  const raw = readTranscriptRaw(sessionId);
  if (raw === null) return null;
  const items: ThreadItem[] = parseEntries(raw).map((e) => ({ ...e }));
  let lastAgent: ThreadItem | null = null;
  for (const item of items) {
    if (item.role === "agent") {
      item.final = false;
      lastAgent = item;
    } else if (lastAgent) {
      lastAgent.final = true;
      lastAgent = null;
    }
  }
  if (lastAgent) lastAgent.final = true;
  return items;
}
