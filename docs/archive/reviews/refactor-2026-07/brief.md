# Task brief: Architecture review + UI refactor spec (Room of Devs)

You are one of two independent reviewers (gpt-5.6 via codex, grok-4.5 via
cursor-agent). Work alone; a cross-review round happens later.

## Context

Read `CLAUDE.md` at the repo root first — it describes the project, the
architecture flow, the two-location install gotcha, and the refactor mandate.
Short version: a personal macOS tool that grew from a SwiftBar menu-bar
script into (a) a Tauri 2 desktop panel (`panel/`) and (b) a mobile web page
(`tts-server/mobile.html`), both fed by a Node/TS daemon (`tts-server/src/`)
over WS (panel) and SSE (mobile) from one shared `PanelSnapshot`.

Key problem files (line counts):
- `tts-server/mobile.html` — 4,567 lines, single file: HTML + CSS + JS, all
  UI built via template strings.
- `panel/src/main.ts` — 2,868 lines, same style, plus `markdown.ts`,
  `style.css`.
- Server hotspots: `panel-ws.ts` (1,415), `audio.ts` (1,085), `hid.ts`
  (1,063), `mobile-http.ts` (715).
- `scripts/` — ~45 bash scripts, some legacy (see CLAUDE.md "Known issues").
- `plugins/cursor-read-aloud.5s.sh` — legacy SwiftBar UI, still installed.

The owner has mandated: componentize both UIs in React (or similar) with
SHARED components and design tokens between desktop panel and mobile page.
Mobile got the recent polish (live "call" mode, chat view, threads); desktop
lags visually. Both platforms share features (room grid of persona cards,
now-playing, mute/pause, replay, live mode) and have exclusive features
(desktop: dock/floating modes, HID/arcade button; mobile: call view, push-to-
talk reply, audio streaming to phone).

Owner note on the desktop wrapper: the floating room panel does NOT need to
be always-on-top / follow-across-desktops (it's annoying). Always-on-top only
makes sense for the docked view. If the Tauri window setup was chosen around
always-on-top, that constraint is lifted — but stay practical; a native-ish
Mac window with a web UI is still wanted.

## Your deliverables

Write ONE markdown file at the output path given in your prompt. Sections:

1. **Architecture concerns** — anything of concern or issue in the current
   architecture (server, UIs, IPC/state layer, deploy/sync scheme, scripts).
   Be specific: file + what's wrong + why it matters. Rank by severity.
2. **Cross-platform inconsistencies** — features that exist on both the
   desktop panel and the mobile page but are implemented differently with no
   obvious reason (rendering, state handling, action wiring, styling,
   naming). Cite both locations per item.
3. **Refactor spec** — a concrete proposal to move the inline/template-string
   UI into React components shared across desktop + mobile:
   - Target repo/package structure (where shared components, tokens, state
     client, and platform shells live; pnpm workspace or not).
   - Component inventory: which UI pieces become shared components, which
     stay platform-specific.
   - State layer: how one shared client core consumes PanelSnapshot over WS
     (panel) vs SSE (mobile), actions/commands back to the daemon.
   - Build & deploy changes: mobile needs a real build step replacing the raw
     mobile.html sync; how panel (Vite/Tauri) and mobile builds share code;
     how `tts-server.sh`/`setup.sh` change.
   - Migration plan in phases, each shippable and verifiable, ordered to
     de-risk (don't propose a big-bang rewrite).
   - Risks + mitigations.
4. **Open questions** — decisions the owner must make.

## Hard constraints

- READ-ONLY except your single output file. Do not modify any repo file, do
  not run `setup.sh`, `tts-server.sh`, or anything that starts/restarts the
  daemon or touches `~/.cursor/tts/`.
- NO live Gemini or ElevenLabs API calls. Nothing in this task needs them.
- pnpm, never npm, in any commands you propose.
- The JSON/lock/pid filesystem state under `~/.cursor/tts/` is the IPC
  contract with hook processes — the refactor targets the UI layer; server
  file splits may be proposed but the IPC contract stays.
- Don't propose adding a test-suite/CI apparatus; verification here is
  manual/scripted (see CLAUDE.md).
