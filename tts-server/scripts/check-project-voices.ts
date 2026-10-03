#!/usr/bin/env tsx
/**
 * Free, offline check for project voices (#97): voice resolution order,
 * project derivation (worktrees → repo name), set_project_voice validation,
 * the AgentView.failed flag, and the GET /project-voices payload.
 *
 *   pnpm exec tsx scripts/check-project-voices.ts          # sandbox asserts
 *   pnpm exec tsx scripts/check-project-voices.ts --real   # read-only print
 *
 * Sandbox mode points HOME, TTS_DIR and the sessions registry at a temp dir
 * before any daemon module loads, so nothing touches ~/.cursor/tts or T3.
 * --real keeps HOME (reads ~/.claude and ~/projects, read-only) but still
 * sandboxes TTS_DIR, so the room snapshot is empty and nothing is written.
 * No API calls in either mode.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL = process.argv.includes("--real");
const root = mkdtempSync(join(tmpdir(), "project-voices-"));
const home = REAL ? process.env.HOME! : join(root, "home");
const tts = join(root, "tts");
const sessionsDir = join(root, "sessions");

const realTts = join(process.env.HOME!, ".cursor", "tts");
process.env.TTS_DIR_OVERRIDE = tts;
if (!REAL) {
  process.env.SESSIONS_DIR_OVERRIDE = sessionsDir;
  process.env.HOME = home;
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`,
  );
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

for (const d of ["state", "queue", "played", "failed", "logs"]) {
  mkdirSync(join(tts, d), { recursive: true });
}
mkdirSync(sessionsDir, { recursive: true });

if (REAL) {
  await runReal();
} else {
  await runSandbox();
}
rmSync(root, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll project-voice checks passed.");

async function runReal(): Promise<void> {
  // Read-only copy so the payload's character list is the real roster.
  if (existsSync(join(realTts, "characters.json"))) {
    copyFileSync(join(realTts, "characters.json"), join(tts, "characters.json"));
  }
  const { allCatalogSessions } = await import("../src/session-catalog.js");
  const { projectNameForDir, projectsForSessions } = await import("../src/session-voice.js");

  // Current room cards (real state/, read-only) through the snapshot's batch
  // derivation: registry cwd, T3 project root for SDK cards.
  const realState = join(realTts, "state");
  const cards = existsSync(realState)
    ? readdirSync(realState)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const sessionId = f.slice(0, -5);
          try {
            const s = JSON.parse(readFileSync(join(realState, f), "utf-8")) as { sdk?: boolean };
            return { sessionId, sdk: s.sdk === true };
          } catch {
            return { sessionId, sdk: false };
          }
        })
    : [];
  console.log("room cards → project (real registry + T3, read-only):");
  for (const [id, p] of projectsForSessions(cards)) {
    const sdk = cards.find((c) => c.sessionId === id)?.sdk ? "sdk" : "cli";
    console.log(`  ${id.slice(0, 12)} ${sdk} → ${p.project ?? "null"}  ${p.threadTitle ?? ""}`);
  }
  console.log("");
  const { projectVoicesPayload } = await import("../src/services/project-voices.js");
  const byShape = new Map<string, string>();
  for (const s of allCatalogSessions()) {
    const shape = s.dir.replace(home, "~");
    if (!byShape.has(shape)) byShape.set(shape, projectNameForDir(s.dir) ?? "(null)");
  }
  console.log("cwd → project (real transcripts):");
  for (const [dir, project] of [...byShape].sort()) console.log(`  ${dir} → ${project}`);
  const payload = projectVoicesPayload();
  console.log("\nGET /project-voices projects (real ~/projects, empty room):");
  for (const p of payload.projects) {
    console.log(
      `  ${p.name.padEnd(28)} ${p.lastActivityAt ?? "null"}  dir=${p.dir ? "yes" : "null"}`,
    );
  }
  console.log(`characters: ${payload.characters.map((c) => c.name).join(", ")}`);
}

async function runSandbox(): Promise<void> {
  // ── Fixture world ──
  const projects = join(home, "projects");
  mkdirSync(join(projects, "comic-reader", ".git"), { recursive: true });
  mkdirSync(join(projects, "cursor-read-aloud", ".git", "worktrees", "issue-85"), {
    recursive: true,
  });
  mkdirSync(join(projects, "cursor-read-aloud", "tts-server"), { recursive: true });
  mkdirSync(join(projects, "notes"), { recursive: true }); // plain dir, no git
  // Worktree container: ~/projects/room-of-devs-worktrees/issue-85 (.git file).
  const wt = join(projects, "room-of-devs-worktrees", "issue-85");
  mkdirSync(wt, { recursive: true });
  writeFileSync(
    join(wt, ".git"),
    `gitdir: ${join(projects, "cursor-read-aloud", ".git", "worktrees", "issue-85")}\n`,
  );
  // Claude worktree inside the repo.
  const claudeWt = join(projects, "comic-reader", ".claude", "worktrees", "agent-a1");
  mkdirSync(claudeWt, { recursive: true });
  writeFileSync(join(claudeWt, ".git"), "gitdir: ../../../.git/worktrees/agent-a1\n");

  writeJson(join(tts, "config.json"), { elevenlabs_voice_id: "DONNIEvoice" });
  writeJson(join(tts, "characters.json"), {
    MIKEYvoice: { name: "Michelangelo" },
    DONNIEvoice: { name: "Donatello" },
    KARAIvoice: { name: "Karai" },
    HIDDENvoice: { name: "Hidden One", hidden: true },
  });

  const sid = (n: number) => `0000000${n}-aaaa-bbbb-cccc-00000000000${n}`;
  const sessions: Array<[string, string]> = [
    [sid(1), join(projects, "comic-reader")], // explicit Karai
    [sid(2), join(projects, "comic-reader")], // project → Mikey
    [sid(3), join(home, ".t3", "worktrees", "fleet", "t3code-1")], // unknown voice → default
    [sid(4), wt], // worktree of cursor-read-aloud → Karai via project
    [sid(5), join(projects, "cursor-read-aloud", "tts-server")], // subdir → repo
  ];
  sessions.forEach(([id, cwd], i) =>
    writeJson(join(sessionsDir, `${1000 + i}.json`), { sessionId: id, cwd, name: `s${i + 1}` }),
  );
  writeJson(join(tts, "session_voices.json"), { [sid(1)]: "KARAIvoice" });
  writeJson(join(tts, "project_voices.json"), {
    "comic-reader": "MIKEYvoice",
    fleet: "UNKNOWNvoice",
    "cursor-read-aloud": "KARAIvoice",
  });
  const now = new Date().toISOString();
  const state = (id: string, s: string) =>
    writeJson(join(tts, "state", `${id}.json`), {
      sessionId: id,
      name: id.slice(0, 8),
      state: s,
      raisedAt: null,
      updatedAt: now,
    });
  state(sid(1), "working");
  state(sid(2), "idle");
  state(sid(3), "idle");
  state(sid(4), "idle");
  state(sid(5), "idle");
  // failed/ vs played/: s2 newest failed (flag), s3 played after failure (no
  // flag), s1 failed but working again (no flag), s5 failed but a newer item
  // still queued (no flag). Unpadded ms on purpose: 999 vs 1000 numeric order.
  const short = (id: string) => id.slice(0, 12);
  const touch = (dir: string, name: string) => writeFileSync(join(tts, dir, name), "{}");
  touch("played", `1790000000-5-cc-${short(sid(2))}.json`);
  touch("failed", `1790000100-7-cc-${short(sid(2))}.json`);
  touch("failed", `1790000000-999-cc-${short(sid(3))}.json`);
  touch("played", `1790000001-0-cc-${short(sid(3))}.json`);
  touch("failed", `1790000200-1-cc-${short(sid(1))}.json`);
  touch("failed", `1790000300-1-cc-${short(sid(5))}.json`);
  touch("queue", `1790000400-2-cc-${short(sid(5))}.json`);

  const sv = await import("../src/session-voice.js");
  const { resolveVoiceId } = await import("../src/elevenlabs.js");
  const { buildSnapshot } = await import("../src/state-watch.js");
  const { setProjectVoice, projectVoicesPayload } = await import(
    "../src/services/project-voices.js"
  );
  const { dispatchPanelAction } = await import("../src/services/commands.js");
  const { loadProjectVoices } = await import("../src/config.js");

  // ── Project derivation ──
  check("repo root → name", sv.projectNameForDir(join(projects, "comic-reader")), "comic-reader");
  check("repo subdir → repo", sv.projectNameForDir(sessions[4]![1]), "cursor-read-aloud");
  check(
    "~/projects/<x>-worktrees/<b> (.git file) → main repo",
    sv.projectNameForDir(wt),
    "cursor-read-aloud",
  );
  check("<repo>/.claude/worktrees/<a> → repo", sv.projectNameForDir(claudeWt), "comic-reader");
  check(
    "~/.cursor/worktrees/<repo>/<b> (gone) → repo",
    sv.projectNameForDir(join(home, ".cursor", "worktrees", "comic-reader", "main-d5c")),
    "comic-reader",
  );
  check("~/.t3/worktrees/<repo>/<b> (gone) → repo", sv.projectNameForDir(sessions[2]![1]), "fleet");
  check(
    "~/projects/<repo>-wt/<b> (gone) → repo",
    sv.projectNameForDir(join(projects, "comic-reader-wt", "issue-103")),
    "comic-reader",
  );
  check(
    "plain ~/projects/<x>/sub → x",
    sv.projectNameForDir(join(projects, "notes", "a", "b")),
    "notes",
  );

  // ── Resolution order ──
  check("explicit session voice wins", resolveVoiceId(sid(1)), "KARAIvoice");
  check("project voice applies", resolveVoiceId(sid(2)), "MIKEYvoice");
  check("unknown project voiceId → default", resolveVoiceId(sid(3)), "DONNIEvoice");
  check("worktree session → repo's project voice", resolveVoiceId(sid(4)), "KARAIvoice");
  check("no session → default", resolveVoiceId(undefined), "DONNIEvoice");
  check(
    "sources",
    [...sv.resolveEffectiveVoices([sid(1), sid(2), sid(3)]).values()].map((v) => v.source),
    ["session", "project", "default"],
  );

  // ── Snapshot ──
  const agents = new Map(buildSnapshot().map((a) => [a.sessionId, a]));
  check(
    "snapshot project/character",
    [1, 2, 3, 4, 5].map((n) => [agents.get(sid(n))?.project, agents.get(sid(n))?.character]),
    [
      ["comic-reader", "Karai"],
      ["comic-reader", "Michelangelo"],
      ["fleet", "Donatello"],
      ["cursor-read-aloud", "Karai"],
      ["cursor-read-aloud", "Karai"],
    ],
  );
  check(
    "snapshot failed flags",
    [1, 2, 3, 4, 5].map((n) => agents.get(sid(n))?.failed),
    [false, true, false, false, false],
  );

  // ── set_project_voice ──
  check("set valid", setProjectVoice("notes", "MIKEYvoice"), "ok");
  check("stored", loadProjectVoices().notes, "MIKEYvoice");
  check("clear with empty voiceId", setProjectVoice("notes", ""), "ok");
  check("cleared", "notes" in loadProjectVoices(), false);
  check("clear absent is ok", setProjectVoice("never-set", ""), "ok");
  check("unknown voiceId rejected", setProjectVoice("notes", "NOPEvoice"), "bad_persona");
  check("inherited key rejected", setProjectVoice("notes", "constructor"), "bad_persona");
  check("path project rejected", setProjectVoice("../etc", "MIKEYvoice"), "bad_message");
  check("slash project rejected", setProjectVoice("a/b", "MIKEYvoice"), "bad_message");
  check("empty project rejected", setProjectVoice("", "MIKEYvoice"), "bad_message");
  check(
    "oversized project rejected",
    setProjectVoice("x".repeat(101), "MIKEYvoice"),
    "bad_message",
  );
  check("padded project rejected", setProjectVoice(" notes", "MIKEYvoice"), "bad_message");
  check(
    "/action path (Android string fields) accepts",
    dispatchPanelAction({ type: "set_project_voice", project: "fleet", voiceId: "KARAIvoice" }),
    true,
  );
  check("…and applies to the fleet session", resolveVoiceId(sid(3)), "KARAIvoice");
  check(
    "/action rejects unknown voice",
    dispatchPanelAction({ type: "set_project_voice", project: "fleet", voiceId: "NOPEvoice" }),
    false,
  );
  check(
    "/action rejects extra keys",
    dispatchPanelAction({ type: "set_project_voice", project: "fleet", voiceId: "", x: 1 }),
    false,
  );

  // ── GET /project-voices ──
  const payload = projectVoicesPayload();
  const names = payload.projects.map((p) => p.name);
  check("worktree container excluded", names.includes("room-of-devs-worktrees"), false);
  check(
    "dir-less voice-only project listed",
    payload.projects.find((p) => p.name === "fleet")?.dir,
    null,
  );
  check(
    "comic-reader row",
    (({ name, voiceId, character }) => ({ name, voiceId, character }))(
      payload.projects.find((p) => p.name === "comic-reader")!,
    ),
    { name: "comic-reader", voiceId: "MIKEYvoice", character: "Michelangelo" },
  );
  const sorted = [...payload.projects].sort((a, b) => {
    if (a.lastActivityAt === b.lastActivityAt) return a.name.localeCompare(b.name);
    if (!a.lastActivityAt) return 1;
    if (!b.lastActivityAt) return -1;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
  check(
    "sorted by lastActivityAt desc, nulls last",
    names,
    sorted.map((p) => p.name),
  );
  check(
    "characters sorted, hidden excluded",
    payload.characters.map((c) => c.name),
    ["Donatello", "Karai", "Michelangelo"],
  );
  console.log("\npayload sample:", JSON.stringify(payload.projects.slice(0, 3)));
}
