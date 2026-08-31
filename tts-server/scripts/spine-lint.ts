#!/usr/bin/env tsx
/**
 * spine-lint — the one-`state/*`-per-issue invariant (#75, docs/active/architecture-concepts/09).
 *
 * Every open issue carries exactly one `state/*` label, and a `state/working`
 * issue has a claim comment (claim-at-start writes one before work begins).
 * The digest in tap-in.ts trusts the labels; a mislabelled ticket silently
 * drops out of the operator-gate and in-flight lists, so count violations are
 * accuracy bugs, not tidiness.
 *
 *   pnpm spine-lint          # from the repo root (CI runs this on push)
 *
 * Read-only: one `gh issue list` call, no LLM, no TTS.
 */
import { spawnSync } from "node:child_process";

type Issue = {
  number: number;
  title: string;
  labels: { name: string }[];
  comments: { body: string }[];
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

const failures: string[] = [];
for (const i of issues) {
  const states = i.labels.filter((l) => l.name.startsWith("state/")).map((l) => l.name);
  if (states.length !== 1) {
    failures.push(
      `#${i.number} has ${states.length} state/* labels (${states.join(", ") || "none"}) — ${i.title}`,
    );
  } else if (states[0] === "state/working" && i.comments.length === 0) {
    failures.push(`#${i.number} is state/working with no claim comment — ${i.title}`);
  }
}

if (failures.length) {
  console.error(`[spine-lint] ${failures.length} violation(s) of one-state/*-per-issue (#75):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[spine-lint] OK — ${issues.length} open issue(s), one state/* label each`);
