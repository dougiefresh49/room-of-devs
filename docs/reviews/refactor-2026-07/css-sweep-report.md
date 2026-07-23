# Phase 6 dead-CSS sweep — panel + shared UI

Date: 2026-07-23  
Scope: `panel/src/style.css`, `packages/ui/src/components.css`  
Out of scope (untouched): `packages/ui/src/tokens.css`, Tailwind entry CSS, `packages/mobile/src/styles.css`  
No live API calls.

## Allowlist (mandatory — do not remove)

Built by grepping `panel/src/`, `packages/ui/src/`, and `packages/room-client/src/` for template-literal / `classList` / conditional class construction before any deletion.

### Dynamic class families

| Family | Construction site | Produced values |
| --- | --- | --- |
| `state-*` | `AgentCard` / `DockView` (`state-${agent.state}`); `StateBadge` (`state-${state}`) | `state-working`, `state-hand_raised`, `state-speaking`, `state-idle` (from protocol `AgentState`) |
| `actions-*` | `AgentCard` / `DockView` (`actions-${mode === "stage" ? 3 : 5}`) | `actions-3`, `actions-5` |
| `button-color-*` | `SettingsView` (`button-color-${color}`) | `button-color-white`, `button-color-blue`, `button-color-red`, `button-color-teal`, `button-color-yellow`, `button-color-green`, `button-color-black` (`BUTTON_COLORS`) |
| toast kind | `App` (`toast ${toast.kind}`) | `launch`, `error` |

### `classList.add` (realm chrome)

| Class | Site |
| --- | --- |
| `dock-window` | `main.tsx` → `document.body` when `windowRole() === "dock"` |
| `dock-mode` | `main.tsx` → `#app` when dock |
| `native-chrome` | `main.tsx` → `document.body` when main window |

### Conditional / toggle suffixes (string-concat)

Kept even when a dedicated rule is absent (base rule may still apply):  
`active`, `up`, `down`, `disconnected`, `stale`, `triage-focus`, `hover-intent`, `speaking-grow`, `grant-loading`, `ended`, `expanded`, `paused-indicator`, `on-stage`, `loading`, `armed`, `disabled`, `muted`, `learning`.

### Data-attribute / JS selectors (not class-token removals)

TS uses `[data-no-grant]` (`usePttGrant`). CSS only has `input[type="checkbox"]` in picker flags. No data-attr-driven style families to allowlist beyond that.

### HTML entries checked

- `panel/index.html` — sole Vite HTML entry (default `index.html`).
- No `dock.html` / second HTML input; two realms share one bundle; realm chrome is applied in `main.tsx` via `classList`.
- `panel/vite.config.ts` — no custom `build.rollupOptions.input`.

## Method

1. Extract unique class tokens from both CSS files (comments stripped).
2. Search usage across `panel/src/**/*.{ts,tsx,html}`, `packages/{ui,room-client}/src/**/*.{ts,tsx}`, plus `panel/index.html`.
3. Require className / classList / string-class context (not bare identifier hits).
4. Keep if literal usage **or** allowlist match **or** element-level reset (`*`, `html`, `body`, `:root`, `#app`).
5. Keep `@keyframes` referenced by surviving rules; keep `:root` aliases used by surviving `var(--*)`.
6. When in doubt → keep (see Uncertain).

## Counts

| File | Class tokens before | Selectors removed | Class tokens after | Notes |
| --- | --- | --- | --- | --- |
| `panel/src/style.css` | 174 | **2 rules** (`.avatar-wrap.speaking-pop`, `.dock-action-divider`) | 172 | ~323 → ~321 selector parts; 2346 → 2335 lines |
| `packages/ui/src/components.css` | 15 | **0** | 15 | All live or allowlisted (`state-*`) |

**Removed: 2** · **Kept: all remaining rules** (panel + components.css).

### Removed selectors

1. **`.avatar-wrap.speaking-pop`** — no TS/TSX/HTML applies `speaking-pop`. Stage engine does not toggle DOM classes. Room speaking emphasis uses `speaking-grow` instead.
2. **`.dock-action-divider`** — no markup or className reference anywhere in the search corpus.

### Comment / doc-only references for removed selectors

| Selector | Non-code reference |
| --- | --- |
| `.avatar-wrap.speaking-pop` | `docs/design-avatar-lipsync.md` (Speaking emphasis section still describes adding `speaking-pop` in dock mode). Not referenced from code comments. |
| `.dock-action-divider` | None found. |

## Uncertain (kept)

| Item | Why kept |
| --- | --- |
| Duplicate `.badge` / `.state-*` / `.chip*` / `.queued-preview` / `@keyframes pulse` / `live-dot-pulse` in `panel/src/style.css` | Deliberate host copy: panel does **not** import `@room/ui/components.css` (see file header there). Removing the panel copy would unstyle the desktop UI. |
| `.toast.error` without `.toast.launch` | `launch` is allowlisted via `toast.kind`; it relies on base `.toast`. |
| `.conn-dot.up` without `.conn-dot.down` | `down` is allowlisted; disconnected styling is the default `.conn-dot`. |
| Full `button-color-*` set | All seven colors are reachable via `nextColor` cycle even if a given color string never appears as a literal in TSX. |
| Dock speaking scale without `speaking-pop` | Design doc still calls for dock `speaking-pop`; current React dock path does not apply it. Left as a product/design follow-up, not re-added CSS. |
| `.chip.queue` in `AgentChips` | Applied in TS; **no** matching rule in either CSS file (missing style, not dead CSS). |

## Verification

```bash
cd panel && pnpm exec tsc --noEmit   # clean (exit 0)
cd panel && pnpm exec vite build     # succeeds (vite v6.4.3)
```

Ran after the sweep in this worktree (`pnpm install` required first — fresh checkout). CSS-only change; TS untouched.
