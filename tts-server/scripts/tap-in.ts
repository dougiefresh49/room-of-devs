#!/usr/bin/env tsx
/**
 * tap-in — spine validation harness (docs/active/architecture-concepts/09).
 *
 * Assembles the room's spine (GH issues + labels + comments, docs/STATUS.md,
 * a docs index, a transcript index) and asks a flash-tier model "where are we?".
 *
 *   pnpm exec tsx scripts/tap-in.ts --dry "where are we?"   # free, no API call
 *   pnpm exec tsx scripts/tap-in.ts "what's waiting on me?" # one flash call
 *
 * Never calls ElevenLabs; never touches the TTS pipeline.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { type Claim, parseClaim, sameSession, trustedLogins } from "./spine-claim";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const MODEL = process.env.TAPIN_MODEL ?? "gemini-3.1-flash-lite";
// gemini-3.1-flash-lite list price, USD per 1M tokens (2026-07). Override if it moves.
const USD_IN_PER_MTOK = Number(process.env.TAPIN_USD_IN ?? 0.1);
const USD_OUT_PER_MTOK = Number(process.env.TAPIN_USD_OUT ?? 0.4);

const CLOSED_LIMIT = 12;
const COMMENT_CHARS = 900;
const BODY_CHARS = 1400;
const TRANSCRIPT_COUNT = 8;
const LIVE_WINDOW_MS = 30 * 60_000;

function loadEnv(): void {
  const p = join(REPO_ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (k && !process.env[k])
      process.env[k] = t
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

function gh(args: string[]): string {
  const r = spawnSync("gh", args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${r.stderr?.trim()}`);
  return r.stdout;
}

function clip(s: string | undefined, n: number): string {
  const t = (s ?? "").replace(/\r/g, "").trim();
  return t.length > n ? `${t.slice(0, n)}\n…[truncated]` : t;
}

type Issue = {
  number: number;
  title: string;
  state: string;
  updatedAt: string;
  closedAt?: string | null;
  body?: string;
  labels: { name: string }[];
  milestone?: { title: string } | null;
  comments?: { author?: { login?: string }; createdAt: string; body: string }[];
};

function renderIssue(i: Issue, opts: { body: boolean; comments: number }): string {
  const labels = i.labels.map((l) => l.name).join(", ") || "(none)";
  const head = `### #${i.number} — ${i.title}\nstate: ${i.state} | labels: ${labels} | milestone: ${i.milestone?.title ?? "none"} | metadata-touched: ${i.updatedAt} (NOT progress — see digest for real activity)`;
  const parts = [head];
  if (opts.body && i.body) parts.push(`body:\n${clip(i.body, BODY_CHARS)}`);
  const comments = (i.comments ?? []).slice(-opts.comments);
  for (const c of comments) {
    parts.push(`comment (${c.createdAt}): ${clip(c.body, COMMENT_CHARS)}`);
  }
  return parts.join("\n");
}

// --- Deterministic digest (fix 2) ----------------------------------------
// Aggregation the model must NOT be asked to do: counts, completeness over
// the room, freshness, and entity disambiguation. Computed in code so flash
// narrates rather than aggregates.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STOPWORDS = new Set(
  // Generic English + the room's own jargon. Room words ("state", "room",
  // "work") collide with ticket titles by coincidence and produced a
  // false-positive ambiguity on the first re-grade — they must not score.
  "the a an is are was were what where when who how why on of in to for and or my me i we our us right now state status thing bug issue ticket about got up overall room everything anything anyone someone things work working works next week month shipped waiting blocked gated pick picked highest leverage hour credits burn did does could should".split(
    " ",
  ),
);

/** Broad status questions name no entity; resolving them is noise, not signal. */
const BROAD_QUESTION =
  /\b(where are we|overall|the room|everything|anything else|what's going on|status of the (room|project))\b/i;

/** When a closed ticket actually closed. updatedAt moves on label edits and is not it. */
function closedTime(i: Issue): number {
  return Date.parse(i.closedAt ?? i.updatedAt);
}

function stateOf(i: Issue): string {
  return (
    i.labels.find((l) => l.name.startsWith("state/"))?.name ?? "(UNLABELLED — invariant violation)"
  );
}

/** Last commit on main whose message references #NN. Real work, unlike updatedAt. */
function lastCommitFor(n: number): string | null {
  const r = spawnSync("git", ["log", "-1", "--format=%cI %h %s", "-E", `--grep=#${n}([^0-9]|$)`], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  const out = r.stdout?.trim();
  return out ? out.slice(0, 140) : null;
}

/** Last SUBSTANTIVE activity: a comment or a commit. Never a label edit. */
function lastSubstantive(i: Issue): string {
  const c = (i.comments ?? []).at(-1);
  const commit = lastCommitFor(i.number);
  const parts: string[] = [];
  if (c) parts.push(`last comment ${c.createdAt}`);
  if (commit) parts.push(`last commit ${commit}`);
  return parts.length ? parts.join(" | ") : "no comments, no commits — never worked";
}

/**
 * The claim a thread dropped at start (#75), in the structured form of #83:
 * `claimed by session <sid>[ / <Persona>], doing <what>`, trusted only from
 * the repo owner (or a designated bot). The sid joins the ticket to LIVE
 * THREADS. Unstructured or untrusted comments are surfaced but never joined.
 */
function claimOf(i: Issue, trusted: Set<string>): { claim: Claim | null; note: string } {
  const comments = (i.comments ?? []).slice().reverse();
  // An untrusted marker must not mask an earlier trusted one: scan the whole
  // trail for the newest TRUSTED marker, remembering untrusted ones to flag.
  let untrusted: (typeof comments)[number] | undefined;
  for (const c of comments) {
    const claim = parseClaim(c.body);
    if (!claim) continue;
    if (trusted.has(c.author?.login ?? ""))
      return {
        claim,
        note: `(${c.createdAt}) session ${claim.session}${claim.persona ? ` / ${claim.persona}` : ""} — doing ${clip(claim.doing, 200)}${untrusted ? ` [a newer untrusted marker from "${untrusted.author?.login ?? "unknown"}" was ignored]` : ""}`,
      };
    untrusted ??= c;
  }
  if (untrusted)
    return {
      claim: null,
      note: `UNTRUSTED claim marker from "${untrusted.author?.login ?? "unknown"}" (not the owner) — ignored, treat the ticket as unclaimed`,
    };
  const loose = comments.find((c) => /\bclaim(ed|ing)?\b/i.test(c.body)) ?? comments[0];
  if (!loose)
    return {
      claim: null,
      note: "NO CLAIM COMMENT — claimed without saying what for (protocol violation)",
    };
  return {
    claim: null,
    note: `unstructured (pre-#83, no session join): (${loose.createdAt}) ${clip(loose.body, 220).replace(/\n+/g, " ")}`,
  };
}

/** Pull the verification evidence out of a settled ticket's trail. */
function verificationNote(i: Issue): string {
  const hit = (i.comments ?? [])
    .slice()
    .reverse()
    .find((c) => /verif|re-ran|reran|proven|checked live|post-deploy/i.test(c.body));
  return hit ? clip(hit.body, 320).replace(/\n+/g, " ") : "NO VERIFICATION NOTE IN THE TRAIL";
}

/**
 * Heuristic liveness the tracker can't give us: transcripts written in the
 * last 30 min mean a thread is ALIVE, whether or not it claimed a ticket.
 * Complements claim-at-start write-back (#75): the claimed ticket says what
 * the work is; the transcript mtime proves the thread is still breathing.
 * Returns null when the transcript directory is unreachable.
 */
function liveSessions(): { id: string; mtime: number }[] | null {
  const dir = join(homedir(), ".claude", "projects", REPO_ROOT.replace(/\//g, "-"));
  if (!existsSync(dir)) return null;
  const cutoff = Date.now() - LIVE_WINDOW_MS;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ id: f.replace(/\.jsonl$/, ""), mtime: statSync(join(dir, f)).mtimeMs }))
    .filter((x) => x.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);
}

/** Entity resolution: which ticket titles does the question's noun phrase match? */
function resolveEntities(question: string, issues: Issue[]): string {
  if (BROAD_QUESTION.test(question))
    return "(broad status question — names no single ticket; answer from the digest lists above)";
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (terms.length === 0) return "(no resolvable noun phrase)";
  const scored = issues
    .map((i) => ({
      i,
      score: terms.filter((t) => i.title.toLowerCase().includes(t)).length,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0)
    return "(question matches no ticket title — answer from STATUS/docs, or say it isn't tracked)";
  const top = scored[0].score;
  const tied = scored.filter((s) => s.score === top);
  if (tied.length > 1) {
    return `AMBIGUOUS — ${tied.length} tickets match equally well. Surface ALL of them, do not pick one:\n${tied
      .map((s) => `  - #${s.i.number} (${stateOf(s.i)}) ${s.i.title}`)
      .join("\n")}`;
  }
  return `best match: #${scored[0].i.number} (${stateOf(scored[0].i)}) ${scored[0].i.title}${
    scored.length > 1
      ? `\nother partial matches: ${scored
          .slice(1, 4)
          .map((s) => `#${s.i.number}`)
          .join(", ")}`
      : ""
  }`;
}

function buildDigest(open: Issue[], closed: Issue[], question: string): string {
  const counts = new Map<string, number>();
  for (const i of [...open, ...closed]) counts.set(stateOf(i), (counts.get(stateOf(i)) ?? 0) + 1);

  const gate = open.filter((i) =>
    ["state/needs-feedback", "state/plan-review"].includes(stateOf(i)),
  );
  const working = open.filter((i) => stateOf(i) === "state/working");
  const cutoff = Date.now() - WEEK_MS;
  const thisWeek = closed.filter((i) => closedTime(i) >= cutoff);

  // Session-to-ticket join (#83): the structured claim marker carries the
  // thread's session id; live transcripts carry the same id. Joined here in
  // code so flash narrates the mapping instead of guessing it.
  const trusted = trustedLogins(REPO_ROOT);
  // An empty set means owner resolution failed, and every valid claim would
  // render as untrusted. Refuse to build (and bill for) a wrong digest.
  if (trusted.size === 0)
    throw new Error("could not resolve the repo owner (gh repo view failed) — cannot trust claims");
  const claims = working.map((i) => ({ i, ...claimOf(i, trusted) }));
  const live = liveSessions();
  const liveness = (claim: Claim | null): string => {
    if (!claim) return "no session id to join on";
    if (live === null) return "thread liveness unknown (transcript directory unreachable)";
    return live.some((s) => sameSession(s.id, claim.session))
      ? "thread LIVE (transcript active)"
      : "thread NOT live (no transcript write in 30 min — stalled, done-but-unsettled, or working elsewhere)";
  };
  const liveLines =
    live === null
      ? "  (transcript directory unreachable — cannot tell)"
      : live.length === 0
        ? "  (no transcript written in the last 30 min — nobody appears to be working)"
        : live
            .map((s) => {
              const owned = claims.filter((c) => c.claim && sameSession(c.claim.session, s.id));
              const doing = owned.length
                ? `working ${owned.map((c) => `#${c.i.number} (${c.i.title})`).join(", ")}`
                : "no claimed ticket — untracked or violating claim-at-start";
              return `  - session ${s.id.slice(0, 8)} last wrote ${new Date(s.mtime).toISOString()} → ${doing}`;
            })
            .join("\n");

  return [
    "## DIGEST — computed deterministically from the tracker. AUTHORITATIVE for counts,",
    "## completeness and freshness. Do NOT re-derive these from the raw tickets below.",
    "",
    `state counts: ${[...counts].map(([k, v]) => `${k}=${v}`).join(" · ")}`,
    "",
    `OPERATOR GATE (waiting on the owner) — ${gate.length} ticket(s). This list is COMPLETE:`,
    gate.length
      ? gate.map((i) => `  - #${i.number} [${stateOf(i)}] ${i.title}`).join("\n")
      : "  (none)",
    "",
    `IN FLIGHT (state/working, claimed at start per #75/#83) — ${working.length}. This list is COMPLETE:`,
    claims.length
      ? claims
          .map(
            (c) =>
              `  - #${c.i.number} ${c.i.title}\n    claim: ${c.note}\n    liveness: ${liveness(c.claim)}`,
          )
          .join("\n")
      : "  (none) — nothing has claimed a ticket. If LIVE THREADS below shows activity,\n  that work is either untracked or violating claim-at-start; say so.",
    "",
    "LIVE THREADS (heuristic — transcripts written in the last 30 min), each joined",
    "to its claimed ticket on the claim marker's session id (#83). The join is",
    "computed; do not re-derive it. One of these is the caller itself.",
    liveLines,
    "",
    `CLOSED IN THE LAST 7 DAYS — ${thisWeek.length}. This list is COMPLETE; naming a subset is a wrong answer:`,
    thisWeek.length
      ? thisWeek
          .map((i) => `  - #${i.number} ${i.title}\n    verified by: ${verificationNote(i)}`)
          .join("\n")
      : "  (none)",
    "",
    "LAST SUBSTANTIVE ACTIVITY per open ticket (comments/commits only — a ticket's",
    "`updated` timestamp is METADATA TOUCHED, e.g. a label edit, and is NOT progress):",
    open.map((i) => `  - #${i.number}: ${lastSubstantive(i)}`).join("\n"),
    "",
    "ENTITY RESOLUTION for this question:",
    resolveEntities(question, [...open, ...closed]),
  ].join("\n");
}

function docsIndex(): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".md")) {
        const first = readFileSync(p, "utf-8")
          .split("\n")
          .find((l) => l.startsWith("# "));
        out.push(
          `- ${relative(REPO_ROOT, p)} — ${(first ?? "").replace(/^#\s*/, "").slice(0, 110)}`,
        );
      }
    }
  };
  walk(DOCS_DIR);
  return out.join("\n");
}

/** Cheap index only: filename, mtime, size, first user prompt. Never raw turns. */
function transcriptIndex(): string {
  const slug = REPO_ROOT.replace(/\//g, "-");
  const dir = join(homedir(), ".claude", "projects", slug);
  if (!existsSync(dir)) return "(no transcript directory reachable)";
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      f,
      p: join(dir, f),
      m: statSync(join(dir, f)).mtimeMs,
      s: statSync(join(dir, f)).size,
    }))
    .sort((a, b) => b.m - a.m)
    .slice(0, TRANSCRIPT_COUNT);
  if (files.length === 0) return "(no transcripts)";
  return files
    .map(({ f, p, m, s }) => {
      let first = "";
      try {
        for (const line of readFileSync(p, "utf-8").split("\n").slice(0, 60)) {
          if (!line.trim()) continue;
          const rec = JSON.parse(line) as {
            type?: string;
            message?: { role?: string; content?: unknown };
          };
          if (rec.type !== "user" || rec.message?.role !== "user") continue;
          const c = rec.message.content;
          const text =
            typeof c === "string"
              ? c
              : Array.isArray(c)
                ? String((c[0] as { text?: string })?.text ?? "")
                : "";
          if (text && !text.startsWith("<")) {
            first = text.replace(/\s+/g, " ").slice(0, 180);
            break;
          }
        }
      } catch {
        /* index entry survives an unparseable transcript */
      }
      return `- ${f.slice(0, 8)} | ${new Date(m).toISOString()} | ${(s / 1024).toFixed(0)}KB | opened with: ${first || "(n/a)"}`;
    })
    .join("\n");
}

function buildContext(question: string): string {
  const openIssues = JSON.parse(
    gh([
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "40",
      "--json",
      "number,title,labels,state,updatedAt,body,milestone",
    ]),
  ) as Issue[];
  const closedIssues = (
    JSON.parse(
      gh([
        "issue",
        "list",
        "--state",
        "closed",
        "--limit",
        String(CLOSED_LIMIT),
        "--json",
        "number,title,labels,state,updatedAt,closedAt,body,milestone",
      ]),
    ) as Issue[]
  ).sort((a, b) => closedTime(b) - closedTime(a));

  // Comments for open issues (live conclusions) AND recent closed ones
  // (the verification trail the digest quotes).
  const cutoff = Date.now() - WEEK_MS;
  for (const i of [...openIssues, ...closedIssues.filter((c) => closedTime(c) >= cutoff)]) {
    i.comments = (
      JSON.parse(gh(["issue", "view", String(i.number), "--json", "comments"])) as Issue
    ).comments;
  }

  return [
    buildDigest(openIssues, closedIssues, question),
    "",
    "## SPINE LAYER 1 — TRACKER (GitHub issues) — raw, for detail the digest omits",
    "Label axes: state/* is the ticket's live state (exactly one per issue); gear/* is the ceremony dial.",
    "",
    "### OPEN TICKETS",
    openIssues.map((i) => renderIssue(i, { body: true, comments: 3 })).join("\n\n"),
    "",
    "### RECENTLY CLOSED TICKETS (settled)",
    closedIssues.map((i) => renderIssue(i, { body: false, comments: 0 })).join("\n\n"),
    "",
    "## SPINE LAYER 2 — REPO: docs/STATUS.md (the 'where are we' page)",
    readFileSync(join(DOCS_DIR, "STATUS.md"), "utf-8"),
    "",
    "## SPINE LAYER 2b — REPO: docs index (path — title). Contents NOT included.",
    docsIndex(),
    "",
    "## SPINE LAYER 3 — TRANSCRIPT INDEX (metadata only; no transcript content included)",
    transcriptIndex(),
  ].join("\n");
}

const SYSTEM = `You are the room's concierge tapping into the spine to answer a status question.
The spine is: the GitHub issue tracker (work state), the repo docs incl. STATUS.md (knowledge state), and a transcript index (raw history, metadata only).

The context opens with a DIGEST computed deterministically in code, then the raw spine.

Rules:
- Answer ONLY from the spine context provided. It is the whole truth you have.
- The DIGEST is authoritative for anything it covers: counts, the operator-gate list, the in-flight list, the complete set closed this week, last substantive activity, and entity resolution. Never re-derive those from the raw tickets, and never narrow one of its "COMPLETE" lists — if it names five, name five.
- If the digest's entity resolution says AMBIGUOUS, surface every candidate. Do not pick one.
- Never treat a ticket's metadata-touched timestamp as progress; use last substantive activity.
- If the answer is not in the spine, say plainly that the spine doesn't record it, and name what would. NEVER guess, estimate, or infer a number that isn't there.
- Cite ticket numbers (#NN) and file paths when they carry the answer.
- If the question is ambiguous (e.g. it matches more than one ticket), say so and cover the candidates.
- Note staleness when it matters: say when the spine was last written and that in-flight work may not be reflected.
- Be spoken-aloud concise: under 150 words unless the question genuinely needs more.`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const question = argv
    .filter((a) => a !== "--dry")
    .join(" ")
    .trim();
  if (!question && !dry) {
    console.error('usage: tap-in.ts [--dry] "where are we?"');
    process.exit(1);
  }

  const t0 = Date.now();
  const context = buildContext(question);
  const assembleMs = Date.now() - t0;

  if (dry) {
    console.log(context);
    console.error(
      `\n[tap-in] DRY — no API call. context=${context.length} chars (~${Math.round(context.length / 4)} tok) assembled in ${assembleMs}ms`,
    );
    return;
  }

  loadEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("[tap-in] no GEMINI_API_KEY — run with --dry");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const t1 = Date.now();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: `${context}\n\n## QUESTION\n${question}`,
    config: { systemInstruction: SYSTEM, temperature: 0.2, maxOutputTokens: 1200 },
  });
  const ms = Date.now() - t1;

  const u = res.usageMetadata;
  const inTok = u?.promptTokenCount ?? 0;
  const outTok = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
  const usd = (inTok / 1e6) * USD_IN_PER_MTOK + (outTok / 1e6) * USD_OUT_PER_MTOK;

  console.log(res.text?.trim() ?? "(empty response)");
  // The cost log: one line per LLM call (seed of the brain-tier cost log, doc 05).
  console.error(
    `[llm] ts=${new Date().toISOString()} model=${MODEL} tier=flash op=tap-in in=${inTok} out=${outTok} total=${inTok + outTok} usd=${usd.toFixed(6)} ms=${ms} assemble_ms=${assembleMs} q=${JSON.stringify(question.slice(0, 80))}`,
  );
}

main().catch((err: unknown) => {
  console.error(`[tap-in] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
