# Build spec — RIG prototype P2: the console

_2026-07-30. Phase 2 of [design-ui-target.md](design-ui-target.md) §9.
This spec is the delegate's work order; target §2/§3 are the design
authority and `docs/active/concepts-round-c-v6/board-rig-refined.html`
is the CSS reference implementation (faceplate ~L944, thread nodes
~L1043–1160, reply deck ~L1488, crew manifest ~L1628). Port its values,
don't reinvent. P1 shipped the `--rig-*` tokens and 12 primitives in
`packages/ui/src/rig/` — build ON them._

## Scope

The **panel main window becomes the RIG console over the EXISTING
snapshot**. No daemon changes, no protocol/schema changes, no mobile
source changes. Supersedes steps 1–3 of
`spec-ui-consolidation-round2.md`; its two input-parity requirements
ride along (desktop typed chat, attachments where you can reply).

Day-1 cuts bind (target §8): **no plot, no spine rail, no salience
ring** — those are P3/P4. No held-question keycaps (data arrives in P5).

## 1. Token-value flip (desktop only — decided, don't relitigate)

`packages/ui/src/tokens.css` is NOT edited (mobile imports it and must
keep its current look until P6). The flip lives in
`panel/src/style.css`'s existing `:root` block (style.css loads after
tailwind-entry, panel-only, so it wins and mobile never sees it):

```css
--room-bg: var(--rig-ink);
--room-bg-elevated: #101216;            /* ink-family step */
--room-surface: var(--rig-gun2);
--room-surface-strong: var(--rig-gun1);
--room-surface-hover: #2b3036;
--room-border: var(--rig-gun-edge);
--room-border-strong: #1a1e24;
--room-text: var(--rig-steel);
--room-muted: var(--rig-steel-dim);
--room-faint: #6a7178;
--room-accent: var(--rig-green);        /* mobile-green era ends on desktop */
--room-danger: var(--rig-red);
--room-interactive: var(--rig-amber);   /* blue era ends on desktop */
--state-working: var(--rig-amber);
--state-hand-raised: var(--rig-red);    /* needs-you = red, per target §2.1 */
--state-speaking: var(--rig-amber-hot);
--state-idle: var(--rig-steel-dim);
```

Also re-point the legacy aliases in the same block (`--amber`,
`--blue`, `--green`, `--red`, `--grey`, `--bg`, `--surface`) at the rig
values so nothing keeps the old palette by the back door.

**color-mix audit (deliberate, not incidental):** style.css has 51
`color-mix` sites; the card/chip-bucket ones die with their buckets
(§4). Every SURVIVING site (picker ~L1445–1950, settings ~L1996–2415,
dock, spotlight, toast, focus ring L796) must be eyeballed under the
new values — accent green and interactive amber land close enough in
most mixes, but fix any spot where contrast collapses or amber-on-amber
collides (that's the working-amber vs data-amber recut the target
warns about: state color for "working" is `--rig-amber`, data/chrome
accents in those views should lean `--rig-steel`/`--rig-amber-dim` so
tags still read). Picker and Settings get NO structural reskin in P2 —
they just have to remain legible and non-embarrassing under the flip;
adjust individual rules where needed.

Mobile guard: `git diff` must show zero changes under
`packages/mobile/` and zero value changes to existing tokens in
`packages/ui/src/tokens.css`.

## 2. New/extended primitives (`packages/ui/src/rig/`)

Same rules as P1 (props in/callbacks out, no IO, rig.css class-based,
`prefers-reduced-motion` honored, gallery section per new primitive):

- **`Waveform`** — the 12-bar talk indicator: `active: boolean`,
  `bars?: number` (12). CSS-animated bars while active (desynced
  delays), flat dim bars when idle. Board: faceplate wave.
- **`StencilLabel`** — the bay/section header treatment used
  everywhere (stencil font, tracked uppercase, left label + right meta)
  if Bay's built-in strip can't be reused standalone; skip if `Bay`
  already covers every use.
- **`TnodeStateTag`** is NOT needed — use `Tag` with tones; add tone
  `"hot"` (amber-hot) to `Tag` if the board's speaking tag needs it.

Everything else composes existing primitives (`Chassis`, `Bay`,
`ScreenBed`, `CrtFace`, `Tag`, `Led`, `Keycap`, `SalienceBar`).
Gallery gains: Waveform active/idle + a composed "thread node" demo
section showing the four node states side by side (composition demo,
built from primitives + the panel's console CSS classes duplicated
minimally, or skip the composed demo if it would drag panel CSS into
the gallery — delegate's call, note it in the PR).

## 3. Console anatomy (panel main window)

New components live in `panel/src/app/console/`; `RoomView.tsx` is
REPLACED by `ConsoleView.tsx` (App.tsx switches to it; delete
RoomView). Console CSS goes in a new `panel/src/console.css` imported
from main.tsx after style.css; replaced style.css buckets are deleted
(§4). All existing behavior invariants hold (§6).

Layout (board section 01): header strip → faceplate row → thread-node
grid (the "rail bay" without the rail) → reply deck; crew manifest +
watch chips + dial chips in a right/side column or lower rack per the
board's proportions. Fit the existing window default size; regions
scroll internally rather than blowing out the window.

### 3.1 Header strip

Keep every existing control (FailedCountBadge, conn-dot, New,
Settings, CC, → Dock) — reskin as a slim gunmetal chassis strip with
stencil title "THE RIG // ROOM OF DEVS". Offline banner keeps its
semantics, restyled as a red-tagged chassis bar.

### 3.2 Faceplate + second-voice bay

- Hero: `CrtFace` size 176 with halo. The face shown = current
  speaker's character while `nowPlaying` is active (use the existing
  `AvatarImg` as the child so the stage engine keeps lipsync/blink via
  ref — NEVER frames through React), else Mikey idle. This renders
  today's reality (any persona can speak); the Mikey-only concierge
  arrives with #73's later phases.
- Name + stencil caption. When the hero is Mikey use the board's
  "ALWAYS ON // STATELESS"; for other speakers show their name +
  "SPEAKING // <session label>".
- Talk lamp (`Led` red/amber) + `Waveform` active while nowPlaying is
  un-ended.
- Transcript line: the current `SummaryPane` machinery (sanitized
  Markdown of `nowPlaying.text`/`rawText`, CC toggle semantics
  preserved) moves under the faceplate as the interpreter transcript
  area (collapsible; `roomSummaryPane` view-state keeps working).
  Delete the old aside.
- **Dial 2 (VOICE) home is LIVE**: a small chip row on the faceplate
  showing current voice settings from server-data `settings` (e.g.
  mood/playback values already rendered in SettingsView's voice rail) —
  read-only mirror, click opens Settings.
- **Donnie bay**: a smaller dark bay plate beside the hero —
  "SECOND VOICE // BAY EMPTY" (checkout doesn't exist yet; static dark
  plate, no invented data, no animation).

### 3.3 Thread nodes (replaces the AgentCard grid)

One `ThreadNode` per snapshot agent, in a grid. Anatomy (board
`.tnode`):

- `CrtFace` size 58 wrapping the existing `AvatarImg` (ref
  registration untouched).
- Callsign = agent name, rename-on-dblclick preserved (view-state
  `renamingSessionId` machinery).
- Meta line: short session id (`S-` + last 4 of sessionId) +
  `TMUX ✓` when `injectable` (dim `NO TMUX` otherwise) + team tag when
  `isTeam`.
- Task line: `queuedPreview` if present, else `live.lastActivity.label`
  if present, else state-appropriate stencil ("STANDING BY").
- State tag + stamp: working (amber tag) / **needs-you** (red tag,
  node glow via drop-shadow on the CutFrame wrapper, held duration
  from `raisedAt` using the shared 15s clock) / speaking (amber-hot
  tag) / idle (dim, "settled"-style dark treatment). Spawning state:
  when the agent is in `staleSessions` or just-spawned (no better
  signal exists yet) render the dashed-border spawning treatment; if no
  clean signal exists, ship without spawning and note it.
- Chips: superseded count, `LiveBadge`, muted, phone — port existing
  chip semantics into `Tag`s.
- `GrantButton` when `hand_raised` (same component, same
  `grantPendingFor` spinner logic).
- `ActionCluster` preserved verbatim (same component, same
  `clusterMode`/`handleClusterAction` wiring) in the node's action
  strip; kill-arm behavior unchanged.
- `usePttGrant` spread on the node root exactly as AgentCard does
  today (hook file untouched; the `.card-actions` firewall class must
  keep matching — keep that class name on the action strip or extend
  `isNonGrantTarget`'s selector ONLY by adding the new class to the
  existing list in the component's usage, not by editing the hook).

### 3.4 Open node (thread tap-in)

Clicking a node's expand affordance opens it (one open node max;
`openNodeId` in view-state, null default). Open node grows innards:

- **Thread history**: last turns from `GET /thread/<sessionId>` — new
  platform adapter (§5). Rendered as dim mono turn rows (role stamp +
  sanitized text), newest at bottom, in a `ScreenBed`.
- **Live tail line**: when `live?.on`, the `lastActivity` label +
  relative stamp as an amber typewriter-style line under the history
  (CSS only, reduced-motion safe).
- Refetch on: open, and whenever a FINAL (non-live kind, has endedAt)
  nowPlaying frame for that session passes — port mobile's `threadRev`
  bump idea from `packages/mobile/src/convo-state.ts:197–210` in
  simplified form. No polling loops.
- NO spend strip, NO diff panel in P2 (data doesn't exist — render
  nothing, not fakes).
- The reply deck (§3.5) targets the open node when one is open.

### 3.5 Reply deck (desktop typed chat + attachments — input parity)

Bottom rack, board "REPLY DECK":

- **Composer**: `ScreenBed` field + `INJECT ⏎` `Keycap`. Target = the
  open node's session, else the single injectable agent if exactly one
  exists, else disabled with stencil hint "OPEN A NODE TO REPLY".
  Bound line above the field: `REPLY // <callsign> · TMUX INJECT`.
  Submit through the existing command seam
  (`runCommand({type:"reply", sessionId, text})` — the daemon's
  `handleReplyAction` is already wired on panel-ws). Enter sends,
  Shift+Enter newline; disable while in-flight; error toast on
  CommandResult failure (existing commands.ts path). Draft kept in
  component state per session (no new store).
- **Attachments** (desktop-only mechanism, zero wire change): paste or
  drag an image/file into the composer → platform adapter
  `saveAttachment(name, bytes)` (§5) writes it under
  `~/.cursor/tts/attachments/` → a chip appears in the composer → on
  send, append `\n[attached file: <absolute path>]` per attachment to
  the injected text (the receiving Claude Code session reads the path).
  Multiple attachments allowed; chip has a remove ✕.
- **PTT bar**: mount `usePttGrant(targetSessionId)` on the bar (a
  third consumer, same pattern as AgentCard/DockView; hook file
  untouched). Cold: "MIC COLD · HOLD TO TALK"; hot (holding): red
  lamp + "CAPTURING — RELEASE TO SEND" + `Waveform` active. Only
  rendered when a target session exists.
- **Grant chip**: green chip "SPEAKER GRANT ARMED · <countdown>" when
  a cross-realm/pending grant exists (`grantPendingFor` /
  `latestCrossRealmPending` — render only, no new dispatch paths).

### 3.6 Crew manifest, watch chips, dial homes

- **Crew manifest**: the 7 personas from `personas.ts` as plates
  (board `.crew`): small `CrtFace` + name + voice caption; LIT when
  some agent's `character` matches (amber edge + led), DARK otherwise.
  Pure snapshot render, no actions in P2.
- **Watch-order chips**: one dashed amber chip per agent with
  `live.on`: `WATCH ORDER · <callsign> · CLICK TO STAND DOWN`; click →
  existing live-off command (same one ActionCluster uses today) via
  the command seam. Pulsing eye `Led`, reduced-motion safe.
- **Dial chips (static homes)**: ceremony gear tag
  (`GEAR: STANDARD — DIAL 1`, dim static Tag) and turn chip
  (`DIAL 3 · ROUTING: FLASH`, dim static Tag) — visibly inert (dim
  tone, no numbers, no animation; NO invented costs). Dial 2 lives on
  the faceplate (§3.2, live).

## 4. style.css kills (promote-and-replace)

Delete on adoption (line refs pre-edit):

- Card bucket L368–648 + speaking/triage L831–858 (AgentCard dies).
- Chips bucket L648–720 (Tag-based replacements).
- Room grid/summary parts of L179–341 that ConsoleView replaces
  (`.cards`, `.room-summary-*` if the transcript area re-homes it —
  keep the shared `.md-*` markdown rules wherever they end up, they're
  also used by dock captions).
- `.card-grant-btn` block if re-homed (grant button still exists — move
  its rules to console.css).

Picker, settings, dock, spotlight, toast buckets STAY (they get the
token flip only). Zero dead selectors left behind: grep for the deleted
class names after the cut.

## 5. Platform adapters + Rust (panel only)

Components never fetch — all IO in `panel/src/platform/`:

- **`threadHistory(sessionId): Promise<ThreadItem[]>`** — GET
  `http://127.0.0.1:<mobile_port>/thread/<id>?limit=40` with the
  Bearer/`?token=` from `~/.cursor/tts/mobile_token`. mobile-http has
  no CORS headers and the webview origin is tauri://, so do the fetch
  in Rust: one new `#[tauri::command] thread_history(session_id)`
  (read token file + `~/.cursor/tts/config.json` `mobile_port`,
  default 4785; plain std/`tauri-plugin-http`-free implementation is
  fine — a minimal blocking HTTP GET via `std::net::TcpStream` is
  acceptable, or add `ureq` to Cargo). Returns the JSON body string;
  TS side parses/validates shape loosely ({role, text, at}).
- **`saveAttachment(name, bytes): Promise<string>`** — new
  `#[tauri::command]` writing to `~/.cursor/tts/attachments/`
  (create dir; filename `<epoch>-<sanitized name>`; return absolute
  path). Reject > 10 MB.
- lib.rs constraint: `set_room_mode`, window/NSPanel logic, and dock
  geometry are UNTOUCHED — only append the two new commands + handler
  registration.
- Mock platform (`platform/mock.ts` if present) gets stub
  implementations so `pnpm dev` in the browser still runs.

## 6. Hard behavior invariants (verify, don't trust)

- Avatar frames NEVER through React renders — `AvatarImg` ref
  registration + stage engine untouched; `CrtFace` wraps via children.
- `usePttGrant.ts` and `grant-guard.ts`: zero diff.
- Dock realm (`DockView`) — zero functional change (it inherits the
  token flip; P1 already reskinned it; eyeball it still reads right
  since it uses `--rig-*` directly).
- Rename, kill-arm, swap-character popover, focus-terminal, replay
  actions: all still work (same components rewired, not rewritten).
- No live Gemini/ElevenLabs calls; nothing under `~/.cursor/tts/`
  touched by the build (attachments dir is created at runtime only).
- `PickerView`/`SettingsView` functional under the flip.
- Mobile: zero source/dist changes; tokens.css existing values
  unchanged (additive only if a new `--rig-*` is needed).

## 7. Verification gate (delegate runs all)

- `pnpm typecheck` clean at root; `cd panel && pnpm exec tsc --noEmit`
  clean; `pnpm check-fixtures` green (proves no protocol drift).
- `cargo check` equivalent: `cd panel && pnpm tauri build --debug`
  compiles the two new Rust commands (build only; install/verify is
  the main session's).
- Gallery still builds (`pnpm --filter @room/ui dev` boots).
- Grep-proof the invariants: `git diff --stat` shows no
  `packages/mobile/`, no `usePttGrant.ts`, no `grant-guard.ts`, no
  `tts-server/` changes.

## References

- `docs/active/design-ui-target.md` §2 (visual system), §3 (surfaces),
  §8 (cuts), §10 (house rules).
- `docs/active/concepts-round-c-v6/board-rig-refined.html` — CSS
  source of truth; cite ported board classes in brief comments.
- `docs/active/spec-rig-p1.md` — what P1 built.
- Recon facts: reply over panel-ws already live
  (`tts-server/src/panel-ws.ts:57`); `/thread` served by
  `tts-server/src/mobile-http.ts:573`; thread hook pattern
  `packages/mobile/src/thread.ts:26`; snapshot fields
  `packages/protocol/src/snapshot.ts` (AgentView: state, injectable,
  isTeam, live, queuedPreview, raisedAt).
