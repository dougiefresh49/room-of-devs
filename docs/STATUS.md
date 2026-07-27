# Room of Devs — STATUS

The single "where are we" page. Update at the end of every shipped
round; publish to the phone with `pnpm docs:publish`.

_Last updated: 2026-07-27 (Round B)_

## Inbox

Owner drop zone — bugs, findings, ideas, "next I want…". One bullet each,
no format rules. Sessions triage these: bugs → fixes/known issues, ideas →
the backlog, work → `active/` specs or Next up. Empty is the goal state.

- _(empty)_

## Now

- **Round B SHIPPED & deployed (2026-07-27)**: issues #62–#67 closed
  (each with a verification note citing what was re-run), plus the #72
  token-persistence rider. Sequenced sub-rounds: Biome first (config +
  one pure format sweep, 102 files), then backend lanes in parallel
  (#62 CI floor + contract single-sourcing; #66+#67 TTS_DIR isolation +
  PreToolUse hooks), then UI lanes serialized (#65 a11y/primitives →
  #64 panel error parity). All deployed: setup.sh + daemon restart +
  panel rebuild/relaunch + mobile dist rebuilt twice.
  - **CI exists now**: typecheck + fixtures + format:check on every push,
    proven red/green with an intentionally-broken branch; the
    container-smoke workflow (daemon in Docker + fake-agent, from #66)
    passed in CI on day one. `pnpm lint` joins CI after the 494-error
    Biome debt (BIOME-LINT-REPORT.md) is paid — that's a follow-up round.
  - **Verification catches this round** (the C-6-regression standard
    held): (1) the lane's PreToolUse hooks were wired wrong
    (root-level key, silently inert) — fixed; the hooks then denied this
    session's own tool calls, which is the proof they work. (2) Codex
    caught Escape dropping focus to body in the mobile sheets; the first
    fix was still wrong (effect-ordering), final fix verified in-browser.
    (3) The #64 lane caught its own billable-path bug (bubbled spacebar
    → PTT hold) before handing off.
  - **Owner-visible changes**: panel now shows a real offline banner and
    disables actions when the daemon is down (and recovers on restart);
    every panel action reports failures instead of fire-and-forget;
    "Read update" is a real keyboard-focusable button; mobile sheets are
    real Radix dialogs (focus trap/Escape/focus return); faint text is
    AA-contrast; **your phone's bookmarked room URL now survives daemon
    restarts** (rotate only via `mobile_url.sh --rotate`).
  - Residuals logged: #72 panel rotate button needs a daemon command;
    port-fallback hardcodes in panel lib.rs / verify-live.ts; keyboard
    PTT hold exists on raised cards + dock avatar (mobile-parity model);
    reduced-motion verified at the CSS level only (no emulation toggle
    in the browser tooling).
- **Round A SHIPPED & deployed (2026-07-27)**: issues #58–#61 merged to
  main and deployed (setup.sh + tts-server restart + panel rebuild). Live
  post-deploy checks passed: LAN `curl` to 4785 refused / loopback +
  Tailscale 200, token rotates on restart & is never logged, `/picker`
  0.98s→0.024s, characters.json resolves with the repo copy gone,
  failedCount badge data live (mobile header shows a red "1 FAILED" badge),
  mobile `/action` allowlist rejects non-mobile types, lockfile tamper
  fails the frozen install. **Verification caught one regression, now
  fixed** (`0f94333`): the audit's "use `=TARGET` at all three tmux sites"
  is correct for session targets but breaks pane targets — `send-keys
  -t "=cr-Don"` errors "can't find pane", which had broken phone-reply
  injection. Fixed by resolving the session's unique pane id (`%NN`) for
  send-keys while keeping the `=`-exact session lookup. The
  second-device check (LAN curl refused, Tailscale succeeds) was
  verified by the owner 2026-07-27 — Round A fully closed.
- **Ptheory audit triaged → GitHub Issues (2026-07-27)**: a friend's
  framework ran a full-stack audit — 106 findings, saved verbatim at
  [archive/reviews/ptheory-audit-2026-07-26.md](archive/reviews/ptheory-audit-2026-07-26.md)
  (stable finding IDs; issues cite them). Principles distilled to
  [reference/agentic-workflow-notes.md](reference/agentic-workflow-notes.md).
  Plan is three sequential rounds, tracked as **GitHub milestones**
  (issues are the work surface for fix sessions; `gh issue view` has
  everything, no session context needed):
  1. **Round A — criticals & quick wins**: perimeter (LAN bind /
     token handling / skip-permissions default), deploy safety
     (characters.json, repo-root default, lockfile pinning), sub-20-line
     reliability fixes (P-1, P-3, P-4, C-4), hook-layer security batch.
  2. **Round B — foundation**: CI floor (typecheck + fixtures +
     both-validators), Biome, contract single-sourcing (Q-1), panel
     error-handling parity with mobile, a11y batch via @room/ui
     primitives, TTS_DIR instance-isolation sweep (enables containers +
     parallel worktree instances), PreToolUse enforcement hooks.
  3. **Round C — UI redesign round 2** (spec unchanged, executes on the
     Round B substrate). R6/R7 architecture epics filed but sequenced
     after all three.
  Verdicts on your machine: C-3 is a clone-path false positive locally;
  C-2 doesn't bite while your local characters.json exists (still fixing
  both). Firewall check 2026-07-27: node has an "allow incoming" rule,
  so 4785 IS LAN-reachable despite the firewall — C-1 stands.
- **UI consolidation round 2 — spec ready, ON HOLD behind Rounds A/B**
  (was: awaiting owner OK):
  deep-module audit ran 2026-07-24 with the codebase-design skill
  (mattpocock/skills now installed in ~/.claude/skills). Headline: nine
  concepts built twice, transport controls ×4, style.css is 2,465 lines
  and the top churn file. Plan = promote-and-replace (PlayerControls →
  AgentCard → PickerFlow, deleting each style.css bucket on adoption):
  [active/spec-ui-consolidation-round2.md](active/spec-ui-consolidation-round2.md).
  Owner leaning yes ("I think number 1"); confirm before lanes launch.
  Prior concerns doc:
  [active/ui-architecture-concerns-2026-07-24.md](active/ui-architecture-concerns-2026-07-24.md).
- **Design concept boards — 20 total; FINAL synthesis round done,
  awaiting owner review + picks**: 4 blind-detailed + 4 synthesis +
  4 wildcard + 4 wildcard-2 + **4 final-synthesis** (2026-07-25:
  each model fused all prior rounds, anonymized, future goals
  structural). Final boards:
  [fable "The Den"](https://6jox1hvrceaf.postplan.dev) ·
  [opus](https://d7wpykv0js50.postplan.dev) ·
  [sol "Workbench"](https://v059dy7f78r7.postplan.dev) ·
  [grok "Floor & Table"](https://ifjfe2tv0zim.postplan.dev).
  fable + opus converged on the same floor/table/tape skeleton. All
  20 grouped on the Postplan dashboard
  (`room-of-devs-ui-concepts`); URLs + notes in the round-2 spec.
  After picks: real React+shadcn mock → lock `design-ui-target.md`.
- **Parallel round 1 MERGED + DEPLOYED** (overnight 2026-07-23→24):
  interpreter Stage 1 (spec now shipped-in-code; codex visual verify
  round pending report), panel parity fixes (icons, speaking-card clip,
  new-session confirm, transport bar removed), mobile sheet fixes
  (overflow/model picker, spawn confirm), plus the mobile spawn-failure
  fix (ghost cards + toasts). Daemon restarted, panel reinstalled,
  mobile dist rebuilt. Codex visual round: 6/8 pass; the speaking-card
  finding led to a follow-up (card scrolls into view when it starts
  speaking — shipped). Owner confirmed the phone New flow looks good.
  Ghost state files cleaned. Remote main caught up 2026-07-27
  (ui-consolidation-round2 fast-forwarded into main and pushed).

## Awaiting owner

- **Round C design picks** — review the four final-synthesis boards
  (URLs in the Round C entry / spec) and pick or mix; the Round C
  kickoff ([active/round-c-kickoff-prompt.md](active/round-c-kickoff-prompt.md))
  is gated on this. If mixing feels hard, the kickoff's fallback is a
  per-surface pick matrix built for you first.

(Cleared 2026-07-27: live mode v2 retest — done; arcade button
bring-up #16 — done; Round A second-device LAN check — verified working;
mic TCC dropped as a tracked item — it's the one-time macOS microphone
permission prompt that fires on first panel PTT recording, self-serve.)

## Next up (likely order)

0. **Audit Rounds A → B → C** — see Now; issues + milestones on GitHub.
1. **Conversational layer** ("dev in the room") — consensus design:
   [active/design-conversational-layer.md](active/design-conversational-layer.md);
   **Stage 1 build spec ready**:
   [active/spec-interpreter-stage1.md](active/spec-interpreter-stage1.md).
2. **Phone image attachments** in live mode.
3. Cross-persona spawn race + subagent-finish announce filtering (small
   daemon fixes — see backlog).

## Someday

See [reference/ideas-backlog.md](reference/ideas-backlog.md) — cmux
evaluation, Android wrapper app, mobile lip-sync, multi-agent conference
mode, Donnie avatar art cleanup, and more.

## Recently shipped

| When       | What                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 2026-07-27 | **Round A — audit criticals & quick wins** (#58–#61): perimeter closed (loopback+Tailscale bind, token rotation/no-log, skip-permissions opt-in, spawn-dir allowlist, minimal spawn env, tmux exact-match + pane guard), deploy safety (characters.json survives deploys, recorded repo-root, frozen-lockfile installs, scripts dir-sync), reliability (API timeouts+retry, failedCount badge, 64KB picker read → 0.98s→0.024s, atomic queue writes, periodic retention), hook-layer security (ingest session-id validation, .env allowlist, secrets/text out of argv, log hygiene, retention guard) |
| 2026-07-23 | Refactor Phases 6-7: legacy deletion (mobile.html, SwiftBar), audio/hid splits |
| 2026-07-22 | Mock live harness (free live-mode regression testing)                 |
| 2026-07-21 | Live mode v2 — call + chat views, /thread history, activity feed      |
| 2026-07-19 | Mobile v2.3 — live streaming to phone, speed button, launch flags     |
| 2026-07-08 | Room of Devs Phases 1-4 — panel, personas, replies, team sessions     |

## How docs/ is organized

| Folder       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `active/`    | Designs/specs for work not yet built — the queue               |
| `shipped/`   | Specs whose feature landed — history, kept for reference       |
| `archive/`   | Superseded specs, old plans, review rounds — read-only past    |
| `reference/` | Evergreen: ideas backlog, testing guides, long-term vision     |
| `mockups/`, `media/` | Assets referenced by docs and README                    |

Rules: a spec moves `active/` → `shipped/` when its feature deploys;
superseded docs get a pointer line at the top and move to `archive/`.
This file is the "where are we" surface; per-task tracking for the
audit rounds lives in GitHub Issues/milestones (agents reach it via
`gh` from any worktree). Repo wiki intentionally unused — docs stay
in-tree so delegated agents can read them.
