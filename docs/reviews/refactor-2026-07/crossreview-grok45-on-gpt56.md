# Cross-review: grok-4.5 on gpt-5.6

Round-1 inputs: `.refactor-review-brief.md`, `review-grok45.md` (mine), `review-gpt56.md`. Contested facts re-checked against the repo on 2026-07-21. Read-only; this file only.

---

## 1. Points of agreement — consensus backbone

These are not decorative overlap; they form a shared delivery spine both reviews already endorse.

1. **UI monoliths must die via incremental React, not a big-bang rewrite.** Both name `panel/src/main.ts` and `tts-server/mobile.html` as mutation-heavy full-`innerHTML` / broad-`render()` surfaces where focus/draft/timers fight the model (mobile’s focus-capture workaround; panel’s rebinding). React islands → shells, shippable phases, manual verification only.

2. **A shared, versioned client contract is mandatory before “shared components” mean anything.** Server `PanelSnapshot` / `AgentView` live in `state-watch.ts`; panel redeclares a *partial* `AgentView` (no `queuedPreview` / `injectable` / `live`); mobile is untyped. Commands are validated in `panel-ws.ts` while each UI invents payloads. React without this boundary re-forks the same drift.

3. **pnpm workspace + shared packages; daemon stays `tsx`.** Both reject Next.js and ad-hoc relative imports across two lockfiles. Panel stays Tauri+Vite; mobile becomes a built static SPA; `~/.cursor/tts/` filesystem IPC stays untouched.

4. **Transport adapters over one store.** WS (desktop) and SSE+POST `/action` (mobile) remain; one snapshot reducer / `RoomClient`; mobile whitelist stays an explicit policy, not an accidental `Set` inside a WS module. `mobile-http.ts` already imports `dispatchPanelAction` / `handleReplyAction` from `panel-ws.js` — the wrong seam both of us want to rename into a command service.

5. **Extract command/picker services from `panel-ws.ts` early; do not refactor `audio.ts` / live-tail synthesis on the React critical path.** Credit guards (mute-before-API, locks, hold-one buffer, phone-grant refuse) stay server authority.

6. **Desktop window policy must change with the UI move.** Current shell always converts to non-activating `NSPanel`, float level, join-all-spaces (`lib.rs:37-59`) plus `alwaysOnTop` in config. Owner note: floating room should not be always-on-top / all-desktops; dock-only for that behavior.

7. **Deploy must become artifact-aware and fail-loud.** Raw `mobile.html` sync dies; mobile-dist (or equivalent) is required; `tts-server.sh` / `setup.sh` / CLAUDE.md update in the same phase. Avatars leave “copied out of `panel/public`” ownership.

8. **Shared component core + platform shells.** Room grid / agent card identity / badges / transport / now-playing / markdown / persona+session picker structure are shared; dock/HID/settings stay desktop; call/chat/phone-audio/PTT stay mobile.

9. **Legacy (SwiftBar, Raycast, bash ingest, `clean_text.py`) is a late audited phase**, not mixed into the first React ship. Manifest callers before delete.

10. **Token unification is required**, and both already flag palette divergence (`style.css` vs mobile `:root`).

---

## 2. Disagreements — where gpt-5.6 conflicts with round-1 grok

### 2.1 Critical ranking: “protocol first” vs “monolith first”

- **gpt-5.6:** Missing shared UI contract is Critical #1; dual application protocols #2; monoliths #3.
- **grok round-1:** Monoliths Critical #1; `panel-ws` hotspot #2; type drift #4.
- **Verdict: Concede ranking to gpt-5.6 for sequencing.** The mandate’s pain is the monoliths, but the *safe* first extract is the wire contract. Panel’s `AgentView` (lines 17–27) literally cannot type `agent.live` / `queuedPreview` that `state-watch.ts` already emits — React islands built on the panel types would bake in the omission. Monoliths remain Critical severity for maintainability; protocol is Critical for *migration order*.

### 2.2 Package shape: one `@room/shared` vs `protocol` / `room-client` / `ui` (+ `assets`)

- **gpt-5.6:** Separate dependency-free `packages/protocol`, transport store in `room-client`, React in `ui`, assets package; apps under `apps/desktop` + `apps/mobile`.
- **grok:** Single `@room/shared` (types+tokens+client+components) and `@room/mobile`; keep `panel/` path.
- **Verdict: Concede the three-way package split; hold on early directory moves.** Daemon and clients can share types without pulling React; that dependency direction is worth the extra package. Physical `panel/` → `apps/desktop` churn is optional risk — gpt-5.6 already softens this (“defer physical directory moves”). Consensus: workspace + `protocol` / `room-client` / `ui` immediately; keep `panel/` and `tts-server/` paths until after client extraction.

### 2.3 Wire envelope: full `ServerEvent` + revision vs thin adapters

- **gpt-5.6:** Introduce `{ snapshot | notice | command_result }` with monotonic `revision` and `requestId` correlation.
- **grok:** Adapters delivering today’s `PanelSnapshot` JSON; shared allowlist metadata; no new revision scheme.
- **Verdict: Partial concede.** Uniform `CommandResult` + WS `requestId` is worth doing — today desktop is mostly fire-and-forget with later `{ type: "error", code }` (`panel-ws.ts` `sendError`), while mobile `postAction` interprets HTTP immediately. A daemon-local revision is cheap insurance against bootstrap `/snapshot` racing SSE, but it is not a blocker for Phase 0 types. **Hold:** do not redesign the entire event surface before first islands; add typed envelopes additively (accept old WS messages during migration, as gpt-5.6 also says).

### 2.4 Tauri: two windows vs one window with mode flags

- **gpt-5.6:** Prefer two windows if dock must remain non-activating all-Spaces panel.
- **grok:** One window; dock = always-on-top / join-spaces; float = normal-ish.
- **Verdict: Soft concede to gpt-5.6’s caution; owner decides.** `lib.rs` comments “call to_panel only once” and *always* converts the only window at startup — runtime NSPanel↔NSWindow flip is not how the app works today. Two windows sharing one React app/store is the safer native path if dock must keep Accessory/NSPanel semantics. One window only works if floating abandons NSPanel entirely and dock is a separate mode implemented carefully (or dock also becomes a normal window — product call).

### 2.5 CSP severity

- **gpt-5.6:** CSP null + `innerHTML` breadth listed under High security concerns.
- **grok:** CSP null as Lower for a personal local app.
- **Verdict: Hold Lower for CSP as a delivery priority; concede the *markdown/innerHTML* risk.** Token/origin/path checks must stay. One shared markdown renderer reduces the real XSS surface. Full CSP inventory can wait until after React cutover when script/asset needs are stable — not a Phase-0 gate for a LAN/personal tool.

### 2.6 Phase order: desktop React before mobile cutover vs mobile Vite earlier

- **gpt-5.6:** Leaf islands → desktop shell → mobile shell + build artifact → delete.
- **grok:** Panel grid → dock/settings → mobile Vite parity clone → shared components into mobile.
- **Verdict: Mostly agree with gpt-5.6; slight hold on “mobile build path.”** Leaf components first (both converge). Desktop shell next is right because Tauri window policy is entangled with the shell. **Hold a thin early spike:** prove `mobile-http` can serve a built `index.html` with a stub page *before* full mobile React parity — gpt’s “switch deployment only after functional parity” is correct for cutover, but deploy plumbing should not wait until Phase 5’s last week (my fail-loud `mobile-dist` check). Compromise: artifact serving path in an early infra phase; feature cutover after parity.

### 2.7 Snapshot caching urgency

- **gpt-5.6:** Per-SSE-client `buildPanelSnapshot()` is High; cache one immutable snap per debounced event.
- **grok:** Noted dual HTTP surfaces and full rebuilds on clients; did not elevate server fan-out.
- **Verdict: Concede the fact; soft-hold the priority.** Verified: `mobile-http.ts:509-512` registers `subscribe(() => buildPanelSnapshot())` per SSE client; WS `broadcastSnapshot` builds once per notify. At one-phone scale this is Fine; the fix is a small server change and should land with command-service extraction or right after — not ahead of protocol/types. Do not couple it to React.

---

## 3. What gpt-5.6 found that I missed

Genuine catches; I am conceding these into the consensus path.

1. **State color semantics are reversed, not just different hexes.** Panel: `.state-working` → `--amber`, `.state-hand_raised` → `--blue` (`style.css:532-537`). Mobile: `--working: #4a9eff` (blue), `--hand: #e6a817` (amber) (`mobile.html:18-19`, badge rules `:227-228`). Shared tokens must be *semantic* (`--state-working`, `--state-hand-raised`), not “pick one green.” My round-1 token note was too shallow.

2. **SSE snapshot fan-out.** Each `/events` client independently rebuilds the full snapshot on every debounced notify (`mobile-http.ts:509-512`), while WS builds once (`panel-ws.ts:735-743`). Real scalability/latency smell as history grows; `state-watch` already debounces at 150ms but does not memoize the built snap.

3. **Duplicated 25s grant optimism.** Panel: `PENDING_GRANT_MS = 25000` + `pendingGrantSessionId` (`main.ts:129,506-532`). Mobile: `grantPending` Map + `25000` timeout (`mobile.html:1587,3936-3945`). Belongs in shared `RoomClient`, once.

4. **`setup.sh` mixes install with billable/external work.** Lines 325–345 fetch ElevenLabs voices and may `generate_sfx.sh` when key present. UI refactor installs must not accidentally spend credits — separate opt-in refresh command. Strong agree; I underweighted this.

5. **`tts-server.sh` sync is weaker than I stated.** Source `cp … || true` (lines 25–26) swallows failures; no lockfile sync; removed `.ts` files can survive restart (unlike `setup.sh`’s `rm -rf` recopy). Atomic stage-then-replace is the right deploy bar.

6. **Protocol package separate from React UI** — dependency hygiene for the daemon import graph and for “types without components.”

7. **Uniform `CommandResult` / request correlation** across WS vs HTTP — I noted allowlists, not result asymmetry.

8. **Animation cadence risk** — lip-sync / karaoke must stay on `requestAnimationFrame` + refs, not full React commits at alignment tick rates. I implied React fixes focus; gpt correctly warns React can *hurt* lipsync if misused.

9. **Baseline capture phase** (screenshots / behavior checklist before visual changes) — cheap de-risk I omitted.

10. **Open questions I under-asked:** multi-phone SSE/audio ownership; which prefs are local vs daemon-backed; identical vs lighter mobile avatar animation; standard titlebar vs custom chrome for floating; build-on-install vs require-prebuilt.

11. **Facade-named splits for later `audio.ts` / `hid.ts`** (`playback-locks`, `now-playing-store`, …) — clearer than my “split when needed.”

---

## 4. What gpt-5.6 missed or got wrong

Verified against code; not nitpicking taste.

1. **“Live” is not merely a deeper mobile view — desktop uses a different meaning of the word.** Panel never references `agent.live`, `set_live`, `queuedPreview`, or `injectable` (grep clean on `main.ts`). `actionClusterMode` returns only `"live" | "idle"` where `"live"` means *Mac lipsync stage* via `isSessionLive` / nowPlaying — and the `"summary"` branch in `actionButtonsHtml` is dead for the room grid because `actionClusterMode` never returns `"summary"` (`main.ts:536-538`). Mobile’s live is narration/call (`set_live`, `agent.live`). gpt-5.6’s inconsistency #7 frames this as ActionClusterMode vs chat/call depth; it understates the wire-field blind spot and the dead summary cluster. Product alignment needs an explicit rename or dual vocabulary (`stage` vs `liveNarration`) or desktop will keep shipping the wrong “live.”

2. **Panel type omission is concrete, not abstract drift.** Server `AgentView` includes `queuedPreview`, `injectable`, `live` (`state-watch.ts:51-55,217-226`); panel interface stops at `isTeam` (`main.ts:17-27`). gpt-5.6 says this correctly in Critical #1 but does not cite the missing fields in the cross-platform table as sharply as the color reversal — implementers need that checklist.

3. **Overweights CSP as High for this app’s threat model.** Personal localhost panel + token-gated LAN mobile; CSP null is real hygiene debt, but it should not compete with protocol extraction, deploy atomicity, or credit-safe install for Phase 0–2 bandwidth.

4. **Snapshot-scan High severity is slightly ahead of today’s usage.** The per-client rebuild is real (conceded above); “until replay/played history grows” is the right caveat gpt already includes — treat as medium-high cleanup alongside services, not a reason to delay UI contract work.

5. **Does not call out credit-efficiency as a first-class UI-phase constraint** the way CLAUDE.md and my risks table do. Shared pending-command store helps *duplicate commands*; it does not replace “never touch mute/live-tail/audio locks in UI phases” and “verify with replay / empty keys.” Consensus should keep that explicit.

6. **`apps/desktop` rename implied as structure target** can be misread as early mandatory move. gpt softens it in open question #8; the cross-review should make **path stability until after protocol/client** a hard recommendation so setup/Tauri paths do not churn twice.

7. **Full revisioned envelope can be over-built if treated as Phase-0.** Additive `command_result` + optional revision: yes. Blocking islands on a complete event redesign: no. Current WS already sends `{ type: "snapshot", ...snap }` and separate notice broadcasts; mobile SSE writes raw snapshot JSON — adapters can normalize without a big-bang protocol version.

8. **Missed (or buried) the still-hot bash ingest fallback.** `hook_stop` → `ingest.ts` with `ingest_claude_code.sh` fallback and `clean_text.py` still in setup copy lists — gpt discusses legacy install generally; the hot-path fallback is why “audit before delete” is not optional folklore.

9. **Persona catalog duplication** — panel hardcodes `PERSONAS` (`main.ts:95+`); mobile uses `/picker`. gpt covers picker transport asymmetry well; the hardcoded desktop catalog is the drift mechanism and should be on the kill list with `SessionPickerData`.

---

## 5. Consensus recommendation

### Endorsed path (merge of both reviews)

Adopt **gpt-5.6’s contract-first sequencing** and **package dependency split**, keep **grok’s path-stability / credit / fail-loud deploy emphasis**, and fold **gpt’s concrete inconsistency catches** (semantic colors, grant pending, SSE fan-out, setup billables, atomic sync).

**Target layout (stable paths first):**

```text
pnpm-workspace.yaml
package.json
packages/
  protocol/          # PanelSnapshot, commands, guards, CommandResult — no React
  room-client/       # store, selectors, grant optimism, WS + SSE/HTTP adapters
  ui/                # tokens.css (semantic state colors), markdown, shared React
  assets/            # avatars source of truth (optional early; can start as ui/public)
panel/               # stays here initially; depends on workspace packages
packages/room-mobile/ or apps/mobile/   # Vite SPA → static dist (name bikeshed OK)
tts-server/          # serves dist; command service extracted from panel-ws
scripts/             # atomic sync; build-ui; install without voice refresh by default
```

Defer `panel/` → `apps/desktop` until protocol + client are green.

### Phases (shippable)

| Phase | Ship | Notes |
|-------|------|--------|
| **0. Baseline + protocol** | Screenshots/behavior checklist; `packages/protocol` mirrored from `state-watch` + command types/guards; fixture JSON from sanitized snapshots | No visual change; both typechecks clean |
| **1. Tokens (semantic) + deploy hygiene spike** | Unify `--state-working` / `--state-hand-raised` (resolve the amber/blue reversal); fail-loud sync draft; optional stub `mobile-dist` serve path; split voice/SFX refresh out of default `setup.sh` | Visual smoke only; no credit in install |
| **2. Server command + picker services** | Extract from `panel-ws.ts`; WS/HTTP thin adapters; keep `MOBILE_ACTION_TYPES` as explicit policy; memoize one snapshot per notify for all SSE clients | Exercise grant/pause/replay/spawn + `/picker` + rejected actions; free replay only |
| **3. Shared `room-client` under old UIs** | Wire panel WS then mobile SSE/HTTP; move 25s grant optimism into client; additive `requestId` / `CommandResult` where easy | Reconnect, notices, stale session; no React required yet |
| **4. Leaf React islands** | Badges, avatar URL helpers, queued preview, markdown, transport buttons, now-playing text — mount in existing shells | Side-by-side screenshots; rAF lipsync untouched |
| **5. Desktop React shell + window policy** | Room/picker/settings; then dock; floating = normal activating window; dock = NSPanel/always-on-top/all-spaces **or** second window (owner pick) | Verify Spaces, text input, snap, HID settings, relaunch |
| **6. Mobile React shell + artifact cutover** | Grid/picker → player → call/thread/composer last (audio adapter preserved); atomic replace of `mobile.html` with dist | Phone SSE, grant, drafts/focus, cached audio only |
| **7. Delete compatibility + legacy audit** | Remove monoliths/duplicate markdown/types; script/plugin caller manifest; SwiftBar default-off or `--legacy` | Hooks still ingest |
| **8. Optional** | `audio.ts` / `hid.ts` facade splits; desktop live indicator / reply depth if owner wants | Never on synthesis hot path casually |

### Risks to keep explicit

- Dual-dispatch during island coexistence → one pending store; controls disable immediately; server locks win.
- Phone autoplay/handoff → migrate audio state machine last.
- React commit cadence vs lipsync/karaoke → time in refs + rAF.
- Installed daemon must not import back into the repo workspace at runtime — stage needed package output with the install.
- No live Gemini/ElevenLabs during refactor verification.

### Remaining owner decisions

1. **Floating vs dock native shape** — two Tauri windows vs one; standard titlebar vs custom chrome for float.
2. **SwiftBar** — uninstall by default, thin launcher, or feature freeze with clear authority.
3. **Desktop live depth** — indicator-only / shared live toggle / full chat-reply port / phone-only forever (and rename panel “live” stage vocabulary).
4. **Canonical state colors** — keep panel mapping, keep mobile mapping, or new palette (semantic names either way).
5. **Mobile artifact policy** — build-on-install vs require prebuilt; commit dist or gitignore.
6. **Multi-phone** — supported or single trusted phone (SSE fan-out + audio ownership).
7. **Prefs scope** — which of hidden-devs / listened / output / drafts stay browser-local vs daemon.
8. **Avatar animation parity** — identical frames vs lighter mobile.
9. **React vs Preact** — both reviews assumed React 19 + Vite; confirm.
10. **Raycast scripts** — keep as external shortcuts or retire in legacy audit.

---

*Cross-reviewer: grok-4.5 on gpt-5.6 · 2026-07-21 · output only this file*
