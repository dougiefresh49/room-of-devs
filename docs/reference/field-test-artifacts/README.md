# retro-artifacts — reusable pieces cited by retro-orchestration.md

Packaged for the multi-agent framework. Provenance per file:

| File | Retro § | Provenance |
|---|---|---|
| `delegate-spec-task-67.md` | §1 | **Verbatim** copy of the scratchpad spec handed to the grok delegate for issue #67 (PR #68). task-16/17/52–56 followed the same format. |
| `cursor-agent-stream-json-pattern.md` | §2.6 | Exact commands as run this project; assembled from the working session (the run-N.jsonl logs themselves were in session scratchpads and are gone). |
| `overnight-watchdog.sh` | §4.7 | **Verbatim** (header line added). State: working sketch, armed Thursday night Aug 7 alongside `caffeinate`; fires a headless `claude --continue` resume on a 5-hour-wall stall. Never fired in anger. |
| `figma-snapshot.py` | §1 | **Verbatim** copy of `scripts/figma-snapshot.py` (also still committed there). |
| `design-mirror-vendoring.md` | §1 | The two REST endpoints, curation lists, sharded layout, and consumption contract — written down from the script + `design-mirror/README.md`. |
| `browser-verification-checklist.md` | §1, §2.1, §4.2/4.4 | **Best-current-version write-down** — the checklist existed as practice + per-issue `report.md`s, never as a standalone doc. Includes the actual `verification-artifacts` branch tree and points at `issue-15/report.md` as the canonical report format. |
| `quota-calibrations.md` | §1 | All recorded calibrations from session memory + skill notes + the billing measurements, consolidated. |

## Asked-for items that never existed (nothing silently missing)

- **A standalone QA checklist document** — never existed; the file here is
  a reconstruction from the runs' reports and session practice (marked as
  such in its header).
- **cursor-agent run logs (`run-N.jsonl`)** — existed in session
  scratchpads during the runs; scratchpads are session-scoped and the
  files are gone. The command pattern is preserved; the raw logs are not.
- **A first-party Cursor tokens-per-percent calibration** — never
  measured (no token logs from the CLI). Flagged as an open item in
  `quota-calibrations.md`.
- Everything else requested existed and is included verbatim.
