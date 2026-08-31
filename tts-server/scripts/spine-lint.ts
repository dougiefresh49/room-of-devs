#!/usr/bin/env tsx
/**
 * spine-lint — the one-`state/*`-per-issue invariant (#75, docs/active/architecture-concepts/09).
 *
 * Every open issue carries exactly one `state/*` label, and a `state/working`
 * issue has a structured claim comment from a trusted login (#83): claim-at-start
 * writes `claimed by session <sid>, doing <what>` before work begins, and the
 * tap-in digest joins live threads to tickets on that sid. The digest trusts
 * the labels and the claim, so a mislabelled ticket or a spoofable claim is an
 * accuracy bug, not tidiness.
 *
 *   pnpm spine-lint          # from the repo root (CI runs this on push)
 *
 * Read-only: two gh calls (issue list, repo owner), no LLM, no TTS.
 */
import { spawnSync } from "node:child_process";
import { parseClaim, trustedLogins } from "./spine-claim";

type Issue = {
  number: number;
  title: string;
  labels: { name: string }[];
  comments: { author?: { login?: string }; body: string }[];
};

const r = spawnSync(
  "gh",
  ["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title,labels,comments"],
  { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
);
if (r.status !== 0) {
  console.error(`[spine-lint] gh issue list failed: ${r.stderr?.trim()}`);
  process.exit(1);
}
const issues = JSON.parse(r.stdout) as Issue[];

const trusted = trustedLogins();
if (trusted.size === 0) {
  console.error(
    "[spine-lint] could not resolve the repo owner (gh repo view failed) — cannot validate claims",
  );
  process.exit(1);
}

const failures: string[] = [];
for (const i of issues) {
  const states = i.labels.filter((l) => l.name.startsWith("state/")).map((l) => l.name);
  if (states.length !== 1) {
    failures.push(
      `#${i.number} has ${states.length} state/* labels (${states.join(", ") || "none"}) — ${i.title}`,
    );
  } else if (states[0] === "state/working") {
    const claim = i.comments.find(
      (c) => trusted.has(c.author?.login ?? "") && parseClaim(c.body) !== null,
    );
    if (!claim) {
      const why = i.comments.some((c) => parseClaim(c.body) !== null)
        ? `only untrusted authors wrote one (trusted: ${[...trusted].join(", ")})`
        : `expected 'claimed by session <sid>, doing <what>' from ${[...trusted].join(" or ")}`;
      failures.push(
        `#${i.number} is state/working with no structured claim comment — ${why} — ${i.title}`,
      );
    }
  }
}

if (failures.length) {
  console.error(`[spine-lint] ${failures.length} violation(s) of the spine invariants (#75, #83):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `[spine-lint] OK — ${issues.length} open issue(s): one state/* label each, structured claims on state/working`,
);
