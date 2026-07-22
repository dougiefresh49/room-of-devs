# Architecture review + UI refactor spec (grok-4.5)

Independent review for the Room of Devs refactor mandate. Read-only exploration of `tts-server/src`, `tts-server/mobile.html`, `panel/src`, `scripts/`, and `panel/src-tauri`. No daemon or API calls.

---

## 1. Architecture concerns

Ranked by severity (highest first). Format: **file → what's wrong → why it matters**.

### Critical

1. **`tts-server/mobile.html` (~4,567) + `panel/src/main.ts` (~2,868) + `panel/src/style.css` (~2,288)** → Entire UIs are monolithic template-string / `innerHTML` re-render loops. Mobile packs HTML, CSS, and JS in one file; panel rebuilds the whole shell on almost every snapshot. → Feature work (live call/chat landed on mobile) cannot be ported cleanly; regressions are inevitable; focus/draft state survives only via ad-hoc preservation hacks. This is the debt the mandate exists to kill.

2. **`tts-server/src/panel-ws.ts` (~1,415)** → One module owns WS lifecycle, snapshot broadcast, message validation, script spawning, team kill/focus, spawn/resume, arcade button CRUD, settings/mood, reply inject, mobile action whitelist (`dispatchPanelAction`), and notices. → Any UI or action change risks collateral damage across desktop *and* phone; the file is past the “smell” threshold and mixes transport with domain.

3. **`tts-server/src/audio.ts` (~1,085)** → Playback, Mac/phone sinks, phone-grant windows, processing markers, locks, replay writers, live `/live-audio` buffering, and now-playing writes share one file. → Credit-sensitive double-fire guards live next to UI-facing metadata; splits here need care, but leaving it as a hotspot makes “don’t break mute/lock/phone grant” reviews harder.

4. **Client type drift vs `state-watch.ts` `PanelSnapshot`** → Server `AgentView` includes `queuedPreview`, `injectable`, `live: { on, toolCount, turnStartedAt, lastActivity }`. Panel’s local `AgentView` omits those fields and never reads `agent.live`. Mobile consumes them for call/chat. → Desktop and phone diverge on the same wire format; panel cannot grow live-mode UI without first fixing types and wiring.

5. **Two-location deploy + partial sync (`scripts/tts-server.sh`, `scripts/setup.sh`)** → Runtime is `~/.cursor/tts/`, not the repo. `tts-server.sh` `cp`s `src/*.ts`, `*.json`, and raw `mobile.html`; `setup.sh` `rm -rf`s the installed server tree and copies the whole package; panel needs `pnpm tauri build` + setup + manual Room.app relaunch. → Easy to “fix” the repo and run stale mobile/panel; mobile build step (required by the mandate) must replace the raw HTML copy or deploys will silently ship yesterday’s UI.

### High

6. **`panel/src-tauri/src/lib.rs` + `tauri.conf.json`** → Window is NSPanel, float level, non-activating, `CanJoinAllSpaces` / fullscreen auxiliary, and `alwaysOnTop: true` in config. Owner note: floating room should *not* be always-on-top / follow-all-desktops; that only fits docked. → Current shell was designed around “menu-bar companion widget”; floating mode fights normal Mac window semantics and is actively annoying.

7. **Dual HTTP surfaces (`panel-ws.ts` :127.0.0.1 + `mobile-http.ts` :0.0.0.0)** → Same `buildPanelSnapshot` / `dispatch*` core, but separate servers, tokens (`panel_ws_token` vs `mobile_token`), and transports (WS vs SSE + POST `/action`). → Correct for LAN phone vs localhost panel, but action allowlists and error shapes diverge; adding a shared client core must treat transport as adapters, not duplicate business rules.

8. **Full-document `innerHTML` re-renders (`panel/src/main.ts` `render` / `renderDock`; mobile `renderMembers` / `renderConvo` / player chrome)** → Every snapshot tears down DOM. Mobile already special-cases reply-focus and Wispr-stable fields; panel rename inputs and popovers fight the same pattern. → React migration is not cosmetic — it is how focus, drafts, and animations stop being bespoke landmines.

9. **`tts-server/src/hid.ts` (~1,063)** → Device I/O, stick triage, character press/hold → scripts, learn/capture, and arcade action dispatch in one place. → Less urgent for the React UI mandate, but it bloating beside `panel-ws` settings/buttons means HID config UI and hardware path stay entangled.

10. **Triple control surface** → Tauri panel, LAN mobile page, and still-installed `plugins/cursor-read-aloud.5s.sh` (~955 lines) plus Raycast scripts under `scripts/raycast/`. → Settings/voice/mood/hold exist in multiple places; refactor without a “source of truth UI” decision will keep shipping three half-synced menus.

### Medium

11. **Duplicated markdown (`panel/src/markdown.ts` vs mobile `mdToHtml`)** → Same job, different rules (panel turns links into inert `<span class="md-link">`; mobile emits real `<a target="_blank">`; heading/list edge cases differ). → Shared message/summary components will disagree until one renderer lives in shared code.

12. **Duplicated persona catalogs** → Panel hardcodes `PERSONAS` in `main.ts`; mobile loads personas from `/picker` (`session-catalog` / mobile-http). → Swap/spawn UX can disagree on labels and who is spawnable.

13. **`scripts/hook_stop.sh` → `ingest.ts` with bash fallback `ingest_claude_code.sh`** → Fallback is still on the hot path if Node/pnpm missing; `setup.sh` still installs the bash ingest and `clean_text.py` (still imported by `notify_queued.sh`; Gemini path reimplemented clean in `gemini.ts`). → Legacy is not inert; audit-before-delete is required, but the install surface stays large.

14. **`audio.ts` / live-tail cost guards are correct but opaque** → Hold-one buffer, mute-before-API, processing locks, phone-grant refuse windows are documented in CLAUDE.md and scattered across files. → UI refactor must not “simplify” these; shared client should treat now-playing/`kind`/`output` as read-only contracts.

15. **No shared package boundary today** → `panel/package.json` and `tts-server/package.json` are separate; avatars sync via rsync from `panel/public/avatars` into `~/.cursor/tts/mobile-assets`. → Shared React/tokens need a workspace (or explicit package) or both apps will keep copying types by hand.

### Lower (still real)

16. **`actionClusterMode` in panel never returns `"summary"` for room cards** → Only dock spotlight uses `"summary"`; room grid is `"live" | "idle"`. Summary button cluster exists but is dead for the main grid. → Symptom of mode logic grown in-place; componentization should make modes explicit.

17. **CSP null in `tauri.conf.json`** → Acceptable for a personal local app; note if the webview ever loads richer remote content.

18. **SwiftBar + panel settings overlap** → Not blocking React work, but every new setting risks a third implementation unless SwiftBar is demoted to “launcher / status only” during the refactor.

---

## 2. Cross-platform inconsistencies

Features that exist on both surfaces but differ without a strong platform reason. Cite both sides.

| # | Topic | Desktop (`panel/`) | Mobile (`tts-server/mobile.html` + HTTP) | Why it matters |
|---|--------|-------------------|------------------------------------------|----------------|
| 1 | **Live mode UI** | No `set_live`; ignores `agent.live`; “live” action cluster means *Mac lipsync stage*, not live narration (`isSessionLive` ≡ stage-worthy nowPlaying) | Full chat + call views, `Go live` / `End live`, activity card, live pin, `POST { type: "set_live" }` | Same snapshot field; opposite product meaning of “live”. |
| 2 | **Reply / inject** | No reply composer; team actions are focus terminal / kill / status | Reply boxes + convo composer → `handleReplyAction` / `inject_prompt.sh` | Reply-capable agents only fully usable from phone. |
| 3 | **Design tokens** | `:root` in `style.css`: `--bg #0d1015`, `--green #49d99a`, `--blue`, `--surface-strong`, … | `:root` in mobile: `--bg #0f1115`, `--accent #3ecf8e`, `--karaoke`, `--working`, … | “Shared look” mandate fails at the variable layer. |
| 4 | **Markdown** | `markdown.ts` — richer blocks; links non-navigating | Inline `mdToHtml` — real anchors; different italics/heading rules | Summary/message text will look wrong when components unify unless one wins. |
| 5 | **Agent card content** | State badge, raised/queue/superseded chips, phone chip; no queued preview line | Waiting preview from `queuedPreview`; queue chip only if `raisedCount > 1`; Chat/Reply affordances | Same `AgentView`, different information density. |
| 6 | **Grant / output routing** | Grant via WS; phone framed as chip when `kind/live` or `output==="phone"` | Explicit Mac vs phone output pref on “Read update” | Users learn two grant models. |
| 7 | **Now-playing / transport** | Lipsync avatars + optional summary pane; footer pause/stop/replay/hold | Mini player + expanded karaoke/message tabs + phone live-audio streaming | Shared “what’s playing” concept, totally different chrome. |
| 8 | **Session picker / personas** | Hardcoded `PERSONAS` + Tauri folder dialog | `/picker` personas + resume list from server | Spawn identity can drift. |
| 9 | **Actions protocol** | Full `PanelMessage` over WS (settings, buttons, PTT, nickname, …) | Whitelist `MOBILE_ACTION_TYPES` + special `reply` over POST `/action` | Fine for security, but clients reimplement validation mentally; shared client should encode the matrix once. |
| 10 | **Realtime transport** | WebSocket + manual reconnect (`RECONNECT_MS`) | `EventSource("/events")` + snapshot SSE; notices piggybacked | Shared state core needs WS/SSE adapters with one snapshot reducer. |
| 11 | **Mute / nickname / voice swap** | Rename + character swap popover on panel | Hidden-dev filter; character data via `/characters`; less in-card voice UX | Overlap without parity. |
| 12 | **Hold / pause / replay** | Footer icons → WS | Header/player → `/action` | Same scripts underneath; UX labeling/placement differs (OK) but state (`paused`, `roomHeld`) should drive one shared control component. |

Platform-*exclusive* (expected, not bugs): desktop dock/float, HID/arcade settings, non-activating panel; mobile call view, PTT-oriented reply, `/live-audio/` and `/phrase-audio/` playback on device.

---

## 3. Refactor spec

### 3.1 Target repo / package structure

Prefer a **pnpm workspace** at the repo root (keeps `tts-server` daemon and `panel` Tauri where they are; adds shared UI once).

```text
cursor-read-aloud/
  pnpm-workspace.yaml          # packages: panel, tts-server, packages/*
  package.json                 # workspace root scripts only
  packages/
    room-shared/               # @room/shared
      package.json
      src/
        types/                 # PanelSnapshot, AgentView, NowPlaying, actions
        tokens/                # CSS variables + maybe tiny token TS map
        markdown/              # single renderMarkdown / stripMarkdown
        client/                # snapshot store + action ports (no React)
        components/            # React: AgentCard, RoomGrid, TransportBar, …
        styles/                # shared CSS entry imported by both apps
    room-mobile/               # @room/mobile — Vite SPA
      package.json
      index.html
      src/main.tsx             # mobile shell: SSE, audio, call/chat routes
      vite.config.ts           # outDir → tts-server/mobile-dist (or dist)
  panel/                       # existing Tauri app; depends on @room/shared
    src/
      main.tsx                 # replaces main.ts monolith gradually
      platform/                # dock, Tauri window APIs, WS connect
  tts-server/                  # daemon unchanged in role; serves built mobile
    src/                       # split hotspots over time
    mobile-dist/               # build output (gitignored or committed — owner call)
  scripts/
    tts-server.sh              # sync built mobile-dist + src
    setup.sh
```

**Why this shape:** shared components/tokens/types live once; panel stays Tauri+Vite; mobile becomes a real build; daemon keeps serving static files over LAN without becoming a React host. Avoid Next.js — both surfaces are local SPAs.

**Not required:** a database; changing `~/.cursor/tts/` queue/state IPC; merging the two HTTP ports (adapters are enough).

### 3.2 Component inventory

**Shared (`@room/shared/components`) — both platforms**

| Component | Responsibility |
|-----------|----------------|
| `RoomGrid` / `AgentCard` | Avatar, state badge, chips, grant CTA slot, muted/triage styling |
| `Avatar` / `AvatarLipsync` | Frame selection; lipsync loop can stay desktop-weighted but API shared |
| `TransportBar` | Pause / stop / replay / hold driven by snapshot `paused` / `roomHeld` / `nowPlaying` |
| `NowPlayingSummary` | Markdown body + speaker name (summary pane / caption / message tab) |
| `KaraokeLine` | Alignment-driven word highlight (mobile player + call card; optional panel) |
| `PersonaPicker` / `PersonaChip` | Single persona list from shared data or `/picker` payload |
| `ConnectionDot` / `NoticeToast` | Conn state + daemon notices |
| `SessionPickerShell` | New/resume tabs structure; platform fills folder browse |

**Shared non-UI**

- `types` from server `PanelSnapshot` (generate or hand-copy once into `@room/shared`, import in panel; server remains source of truth — optionally re-export from a thin `tts-server` types path later).
- `tokens.css` unifying color/spacing names (`--accent` = former mobile accent / panel green).
- `markdown` module (pick panel’s richer renderer; enable real links on mobile).
- `createRoomClient({ transport })` — subscribe(snapshot), send(action), status.

**Platform-specific — desktop (`panel`)**

- Dock shell, snap corners, drag regions, Tauri `ws_token`, window always-on-top policy by mode.
- Settings (mood, speed, arcade buttons, learn capture, shortcuts help).
- Focus terminal / kill arm / nickname rename / character swap (Mac-only sense).
- Accessory activation policy / NSPanel behavior (likely dock-only after owner decision).

**Platform-specific — mobile (`@room/mobile`)**

- Call view + chat view (`spec-live-mode-v2`), live pin, composer, Wispr-stable draft map.
- `<audio>` live-stream / replay / phrase-audio pipeline.
- Output device toggle (Mac vs phone grant).
- Hidden-devs, replay list, token query/`EventSource`.
- Touch hit targets / safe-area / `interactive-widget`.

### 3.3 State layer

```text
                  ┌─────────────────────────┐
                  │  @room/shared/client      │
                  │  RoomStore (snapshot)     │
                  │  reduce(snapshot|notice)  │
                  │  dispatch(Action)         │
                  └───────────┬───────────────┘
                    ▲         │         ▲
         WsTransport│         │         │SseTransport
         (panel)    │         │         │(mobile)
                    │         ▼         │
              panel-ws :4780     mobile-http
              validate+dispatch  whitelist+/reply
                    │         │
                    └────┬────┘
                         ▼
              filesystem IPC ~/.cursor/tts/
```

- **Inbound:** both transports deliver the same `PanelSnapshot` JSON (WS message vs SSE `data:`). Store replaces snapshot atomically; UI selects slices (`agents`, `nowPlaying`, …).
- **Outbound:** `dispatch({ type, ... })` → panel WS `send` or `fetch("/action")`. Encode allowlist in shared metadata (`desktopOnly` / `mobileAllowed`) so UI components disable rather than inventing parallel matrices.
- **Mobile extras:** `GET /thread/:id`, `/replay-list`, `/live-audio/` stay mobile modules calling `fetch`; not required in the panel client until desktop gains chat.
- **No new IPC:** hooks still write queue/state files; daemon still watches; refactor stays above `state-watch` / scripts.

### 3.4 Build & deploy changes

1. **Mobile:** `pnpm --filter @room/mobile build` → static assets in `tts-server/mobile-dist/` (index.html + hashed JS/CSS).
2. **`mobile-http.ts`:** serve `mobile-dist/index.html` (and `/assets/*`) instead of reading `../mobile.html`. Keep token cookie / `?t=` gate. Avatars can remain `/avatars/` as today.
3. **`tts-server.sh sync_source`:** stop copying `mobile.html`; copy or rsync `mobile-dist/` (and still sync `src/*.ts`). Fail loud if `mobile-dist` missing.
4. **`setup.sh`:** after copying `tts-server`, either run mobile build from repo before copy, or copy prebuilt `mobile-dist`. Document: mobile changes need **build + restart**, not just restart.
5. **Panel:** Vite alias `@room/shared`; `pnpm tauri build --debug` unchanged in spirit; shared package must be built/linked via workspace before panel build.
6. **CLAUDE.md:** update “two-location gotcha” and common commands when raw `mobile.html` sync dies.
7. **Dev loop:** `pnpm --filter @room/mobile dev` with proxy to running daemon for `/events` `/action` (or temporary `vite` middleware) — optional phase-2 convenience; production path is built static files.

### 3.5 Migration plan (shippable phases)

Each phase: typecheck (`pnpm exec tsc --noEmit` in touched packages), manual verify per CLAUDE.md (no credit burns), deploy via existing scripts once sync understands the new artifact.

| Phase | Ship | Verify | De-risks |
|-------|------|--------|----------|
| **0. Workspace + types + tokens** | Add pnpm workspace, `@room/shared` with `PanelSnapshot` types + unified `tokens.css`; panel + mobile (still monolith) import tokens only | Visual smoke: colors align; panel/mobile still old renderers | Stops type drift; no behavior bet |
| **1. Server splits (no behavior change)** | Extract from `panel-ws.ts`: `actions.ts` (validate/dispatch), `spawn.ts`, `settings-buttons.ts`; leave WS/HTTP thin | Restart daemon; grant/pause/replay/spawn from panel + one mobile action | Makes UI work safer |
| **2. Shared client core** | `RoomStore` + WS/SSE adapters; wire panel *behind* existing render (store feeds current `agents`/`nowPlaying` vars) | Disconnect/reconnect; snapshot parity | Proves transport abstraction before React |
| **3. Panel React island — room grid** | Replace card grid + footer transport with React; leave dock/settings as legacy `main` modules temporarily | Grant, pause, replay, hold, lipsync on Mac; dock still old OK | Hardest shell kept stable |
| **4. Panel React — dock + settings** | Move dock/spotlight/settings into React; fix always-on-top: **dock on / float off** (owner note) | Dock expand/collapse; Spaces behavior; settings write config | Window policy fixed with UI move |
| **5. Mobile Vite app shell** | New `@room/mobile` serving same UX as current mobile (feature parity clone), cut over `mobile-http` + `tts-server.sh` | Phone: SSE, grant, player, replay list | Eliminates 4.5k HTML file |
| **6. Shared components into mobile** | Swap mobile cards/transport/karaoke/markdown to `@room/shared` | Call/chat still work; drafts/focus preserved | True sharing |
| **7. Align product gaps (optional, owner-gated)** | Panel: read `agent.live`, optional live indicator / deep-link; shared grant output control if desired | No accidental live synthesis; panel stage rules for phone frames stay | Prevents re-divergence |
| **8. Legacy audit** | Map SwiftBar/Raycast/`ingest_claude_code`/`clean_text.py` references; delete or demote with setup.sh updates | Hooks still ingest; menu bar still starts room if kept | Shrinks install surface |

**Ordering rationale:** types/tokens and server action extraction first (cheap, protect credits/IPC); shared client before React; panel grid before dock (dock is Tauri-special); mobile cutover only after a green built artifact path; visual sharing after both are React; legacy last so nothing deletes a hook dependency early.

### 3.6 Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Credit double-fire during UI churn | Never touch mute/live-tail/audio locks in UI phases; verify with `signal.ts replay` / empty keys |
| Mobile cutover 404 / blank page | `tts-server.sh` checks for `mobile-dist/index.html`; keep one-release fallback path to old file if needed |
| Focus/draft regressions (Wispr) | Port mobile’s draft map + focus capture tests manually before deleting monolith |
| Tauri window change breaks dock | Gate always-on-top / collection behavior on `dockMode`; float = normal-ish window |
| Shared component lowest-common-denominator look | Tokens shared; layout props (`density="dock" \| "phone" \| "room"`) rather than forking CSS |
| Workspace slows “edit TS + restart” | Daemon still `tsx` with no bundler; only UI packages build |
| Scope explosion (HID + SwiftBar + audio split) | UI mandate first; audio.ts split only when a concrete bug/feature requires it |
| Type source-of-truth drift again | Phase 0 types owned in shared; comment “mirror state-watch”; optional later codegen |

---

## 4. Open questions

Decisions only the owner can make:

1. **Floating window policy** — Confirm: docked = always-on-top (+ join-all-spaces?); floating = normal/resizable Mac window, no all-desktops, activating OK? Keep non-activating clicks for cards?
2. **SwiftBar’s future** — Keep as thin launcher/status, freeze features, or uninstall once panel+mobile cover settings/voice?
3. **Mobile artifact in git** — Commit `mobile-dist/` for “clone + setup without Node UI toolchain”, or always build on deploy?
4. **Desktop live mode** — Indicator-only, full chat/call port, or phone-only forever?
5. **React vs Preact** — Mandate says React-or-similar; OK with React 19 + Vite, or prefer Preact for phone bundle size?
6. **pnpm workspace root** — Approve monorepo workspace, or keep two packages and a third `packages/room-shared` linked via `workspace:` only?
7. **Design token source** — Mobile’s greener accent (`#3ecf8e`) vs panel’s current palette — which becomes canonical?
8. **Server split depth now** — Extract `panel-ws` actions in phase 1, or UI-only until after first React ship?
9. **Raycast scripts** — Keep as external shortcuts, or document-only / delete in legacy audit?
10. **Panel summary mode** — Restore `"summary"` action cluster on room cards, or delete dead branch when componentizing?

---

*Reviewer: grok-4.5 · Output only: this file · 2026-07-21*
