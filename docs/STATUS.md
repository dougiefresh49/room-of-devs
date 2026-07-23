# Room of Devs — STATUS

The single "where are we" page. Update at the end of every shipped
round; publish to the phone with `pnpm docs:publish`.

_Last updated: 2026-07-23_

## Now

- **Nothing actively in flight.** The July UI/server refactor (Phases
  0-7) is COMPLETE and deployed (2026-07-23).

## Awaiting owner

- **Live mode v2 retest** — the Sesame-style call/chat redesign shipped
  2026-07-21; owner hasn't re-tested the full phone flow since the fixes.
- **Arcade button bring-up (#16)** — hardware-in-hand step (plug in the
  Fosiya encoder, run learn mode). Design:
  [active/design-arcade-button-controller.md](active/design-arcade-button-controller.md).
- **Mic TCC approval** for the panel (one-time macOS prompt).

## Next up (likely order)

1. **Conversational layer** ("dev in the room") — consensus design ready:
   [active/design-conversational-layer.md](active/design-conversational-layer.md).
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
This file is the only tracking surface — no external tools.
