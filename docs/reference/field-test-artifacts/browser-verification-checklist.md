<!-- Artifact 5: the browser-verification/QA method + evidence-branch layout.
Cited by retro §1 (real-pointer verification), §2.1, and §4.2/§4.4. The
checklist existed as practice, not as a document — this is the
best-current-version write-down, with the issue-15 QA report as the
canonical report format. -->

# Browser verification checklist + evidence branch layout

## The checklist (write-down of what the passing runs did)

Setup:
1. `pnpm dev` against the branch under test; viewport 1280×830 (matches the
   mirror's native 1x frames).
2. Isolated browser context (chrome-devtools MCP `isolatedContext`, or
   headless Chrome over CDP when the shared profile is locked — that
   fallback happened in the issue #15 run).
3. Seed state via initScript/localStorage where the scenario needs it
   (plan tier, connected accounts).

Per Figma frame referenced by the issue:
4. Drive the UI to the frame's state using **real pointer clicks and real
   typing only** — never `element.click()`, never CDP `fill()`, never
   synthetic events. (Two escapes came from violating this: #62's 0px-tall
   trigger passed RTL/JS clicks but failed real pointers; a CDP `fill`
   bypassed React onChange and made working undo look broken.)
5. Screenshot → compare side-by-side against `design-mirror/frames/<node>@…png`.
   ImageMagick RMSE as a hint, verdict by visual/spec inspection.
6. Record PASS/FAIL per frame with specifics; FAILs name the component and
   the exact drift.

Per interactive control in scope:
7. Exercise it with a real click and capture before/after screenshots.
   (Post-retro addition: a pixel-identical before/after on a
   state-changing control is an automatic FAIL — this is the check that
   would have caught the dead-looking PRO pill, PR #70.)
8. Verify the behavior contract end-to-end (validation gates, resets,
   persistence across routes), not just state flags.

Wrap-up:
9. Write `report.md` — method, frame table, behavior table, fixes made,
   follow-up candidates (format below).
10. Commit everything to the `verification-artifacts` orphan branch under
    `issue-N/`; link raw.githubusercontent URLs from the issue/PR comment.

## Evidence branch layout (actual tree, orphan branch `verification-artifacts`)

One directory per issue; `app-*` = our UI, `ref-*` = the Figma render;
QA rounds carry a `report.md`:

```
issue-3/ … issue-15/        # MVP-1 build + full-flow QA (issue-15: 23 PNGs + report.md)
issue-37/ issue-41/ …       # retro round
issue-52/ … issue-56/       # owner QA round 2
issue-62-63/                # QA round 3 (combined)
issue-17/                   # Phase 2: selection-tooltip.png, wand-menu.png,
                            #   diff-view.png, upgrade-dialog.png, review-screen-assist.png
issue-67/                   # title-generate-proposal.png
```

Naming convention that emerged: `app-<node-id>-<state>.png` keyed to the
Figma node (see issue-15), so the report's frame table, the mirror PNG, and
the app screenshot all join on node id.

## Canonical report format

`issue-15/report.md` on the branch is the reference: header
(date/branch/viewport/result), **Method**, **Frame pass** table
(node | state | PASS/FAIL | specifics), **Behavior checklist** table
(check | result | evidence), **Fixes made**, **Follow-up candidates** with
file paths. Its honest 6/12-frames-FAIL verdict spawned the retro round
(#37–#43) — reports that can say FAIL are the point of the format.
