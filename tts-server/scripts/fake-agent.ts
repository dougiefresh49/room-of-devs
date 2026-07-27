#!/usr/bin/env tsx
/**
 * fake-agent — drop realistic queue JSON (+ optional transcript lines) into $TTS_DIR.
 *
 * Free by design: with no API keys, Gemini/ElevenLabs skip. For CI smoke, use
 * `--smoke` to enqueue a live-cc intermediate while live is off — the daemon
 * retires it to played/ without synthesis (see index.ts live-off path).
 *
 * Usage:
 *   TTS_DIR=/tmp/tts-test pnpm exec tsx scripts/fake-agent.ts once
 *   TTS_DIR=/tmp/tts-test pnpm exec tsx scripts/fake-agent.ts smoke
 *   TTS_DIR=/tmp/tts-test pnpm exec tsx scripts/fake-agent.ts schedule --interval-ms 2000 --count 3
 *
 * NO live Gemini/ElevenLabs calls from this script.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TTS_DIR =
  process.env.TTS_DIR ?? process.env.TTS_DIR_OVERRIDE ?? join(homedir(), ".cursor", "tts");
const QUEUE_DIR = join(TTS_DIR, "queue");
const STATE_DIR = join(TTS_DIR, "state");
const TRANSCRIPT_DIR = join(homedir(), ".claude", "projects", "fake-agent-harness");

function usage(): never {
  console.error(
    `usage: fake-agent.ts once|smoke|schedule [--interval-ms N] [--count N] [--text "..."]`,
  );
  process.exit(2);
}

function ensureDirs(): void {
  mkdirSync(QUEUE_DIR, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(join(TTS_DIR, "played"), { recursive: true });
  mkdirSync(join(TTS_DIR, "logs"), { recursive: true });
}

function writeQueueItem(opts: {
  text: string;
  sessionId: string;
  title: string;
  source?: string;
}): string {
  const epoch = Math.floor(Date.now() / 1000);
  const name = `${epoch}-fake-${Math.random().toString(36).slice(2, 8)}.json`;
  const path = join(QUEUE_DIR, name);
  const data = {
    text: opts.text,
    conversation_id: opts.sessionId,
    generation_id: "",
    model: "fake-agent",
    timestamp: String(epoch),
    thread_title: opts.title,
    spoken: false,
    ...(opts.source ? { source: opts.source } : {}),
  };
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  return path;
}

function appendTranscript(sessionId: string, text: string): string {
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const path = join(TRANSCRIPT_DIR, `${sessionId}.jsonl`);
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    timestamp: new Date().toISOString(),
  });
  appendFileSync(path, line + "\n");
  return path;
}

function seedMinimalConfig(): void {
  const cfgPath = join(TTS_DIR, "config.json");
  if (existsSync(cfgPath)) return;
  // Ports for container smoke; arcade/hid off.
  writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        elevenlabs_voice_id: "fake-voice",
        playback_mode: "auto",
        panel_port: 4780,
        mobile_port: 4785,
        arcade_enabled: false,
        notifications_enabled: false,
        dnd_auto: false,
        interpreter_enabled: false,
      },
      null,
      2,
    ) + "\n",
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (!mode || mode === "-h" || mode === "--help") usage();

  let intervalMs = 2000;
  let count = 1;
  let text = "fake-agent short ping — no synthesis expected";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--interval-ms") intervalMs = Number(args[++i]);
    else if (args[i] === "--count") count = Number(args[++i]);
    else if (args[i] === "--text") text = args[++i] ?? text;
  }

  ensureDirs();
  seedMinimalConfig();
  console.log(`fake-agent: TTS_DIR=${TTS_DIR}`);

  if (mode === "smoke") {
    // Live-off intermediate → daemon moveToPlayed without API spend.
    const sessionId = "fake-smoke-session";
    const path = writeQueueItem({
      text: "smoke intermediate (live off → played, free)",
      sessionId,
      title: "fake-smoke",
      source: "live-cc",
    });
    appendTranscript(sessionId, "smoke transcript line");
    console.log(`enqueued smoke item: ${path}`);
    return;
  }

  if (mode === "once") {
    const sessionId = "fake-agent-session";
    const path = writeQueueItem({ text, sessionId, title: "fake-agent" });
    appendTranscript(sessionId, text);
    console.log(`enqueued: ${path}`);
    return;
  }

  if (mode === "schedule") {
    const sessionId = "fake-agent-session";
    for (let i = 0; i < count; i++) {
      const path = writeQueueItem({
        text: `${text} (#${i + 1})`,
        sessionId,
        title: "fake-agent",
      });
      appendTranscript(sessionId, `${text} (#${i + 1})`);
      console.log(`enqueued ${i + 1}/${count}: ${path}`);
      if (i + 1 < count) await sleep(intervalMs);
    }
    return;
  }

  usage();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain || process.argv[1]?.endsWith("fake-agent.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
