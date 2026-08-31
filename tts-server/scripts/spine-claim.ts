/**
 * spine-claim — the structured claim marker (#83, follow-up to #75).
 *
 * A claim comment carries a line of the form
 *
 *   claimed by session <sid>[ / <Persona>], doing <what>
 *
 * where <sid> is the thread's session id prefix (the first 8+ hex chars of
 * the transcript filename / session uuid). The sid is the join key between
 * the digest's IN FLIGHT list (claimed tickets) and LIVE THREADS (transcript
 * activity); the persona is optional decoration for the owner's eyes.
 *
 * Trust: on a public repo anyone can comment, and the digest treats claims
 * as authoritative, so a claim only counts when its author is the repo owner
 * or a designated bot login (comma-separated SPINE_CLAIM_BOTS env).
 *
 * Shared by tap-in.ts (digest) and spine-lint.ts (enforcement).
 */
import { spawnSync } from "node:child_process";

/** First 8 chars must be hex (a session id prefix); dashes allowed after (uuid). */
export const CLAIM_RE =
  /^claimed by session ([0-9a-f]{8}[0-9a-f-]*)(?:\s*\/\s*([^,]+?))?,\s*doing\s+(\S.*)$/im;

export type Claim = { session: string; persona?: string; doing: string };

export function parseClaim(body: string): Claim | null {
  const m = CLAIM_RE.exec(body);
  if (!m) return null;
  return { session: m[1], persona: m[2]?.trim(), doing: m[3].trim() };
}

/** Two session ids refer to the same thread when their 8-char prefixes agree. */
export function sameSession(a: string, b: string): boolean {
  return a.slice(0, 8) === b.slice(0, 8);
}

/**
 * Logins whose claim comments are authoritative: the repo owner (resolved
 * live, so a fork lints against its own owner) plus SPINE_CLAIM_BOTS.
 */
export function trustedLogins(cwd?: string): Set<string> {
  const bots = (process.env.SPINE_CLAIM_BOTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const r = spawnSync("gh", ["repo", "view", "--json", "owner", "--jq", ".owner.login"], {
    cwd,
    encoding: "utf-8",
  });
  const owner = r.status === 0 ? r.stdout.trim() : "";
  return new Set([owner, ...bots].filter(Boolean));
}
