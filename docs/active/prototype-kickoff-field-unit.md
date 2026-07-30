# FIELD UNIT kickoff prompt (paste into a fresh session)

_Written 2026-07-30 at the close of prototype v1 (console + plot,
owner-approved "looks great"). Everything through the KEEP-THAT fix is
committed and pushed._

---

Prototype round 2: **THE FIELD UNIT — the five mobile screens**, in the
SAME silo. Read `docs/active/spec-rig-prototype.md` first (the vehicle:
`prototype/` package, mock store, control deck, hard silo rules — no
room-client/protocol/panel/daemon imports, no network) and
`docs/active/design-ui-target.md` §5 (the five screens: GLANCE / ANSWER
/ LISTEN / START / GAUGES, one job each) + §8 day-1 cuts (phone PTT
routes to walk-to-the-rig; keycap+text answering; STOP is free;
gauges read-only; verb rack as tap rows) +
`docs/active/concepts-round-c-v5/board-industrial-mobile.html` (the
mobile board — CSS reference for the phone screens).

Scope: a `/field` route in `prototype/` rendering a phone-frame
viewport (target §5 shell rules: machined chrome only in bezel/keycaps/
levers, phone radii at shell + touch pills, mono micro-ladder, one-thumb
reach arc, PTT pill riveted to the bottom of every screen). Same mock
store and scenario triggers drive it — the control deck stays available
so ARRIVAL/held-question/speak/checkout/lull play out on the phone
screens too. Add field-specific mock bits where §5 needs them (routed
chip / speaker gate, queued-for-lull line, handoff chips, spawning row,
interpreter chip on START).

House rules: this is a PROTOTYPE — mock everything, invent fields in
`mock/types.ts` with comments, taste bar high (the owner judges the
design here). Delegation per Session Token Hygiene (grok/composer lane
against the spec; check `ai-usage` first). Verify: typecheck + build +
a browser round driving every trigger on each of the five screens.

Open items riding along: "craft" naming still provisional; owner hasn't
decided keep-vs-revert on the live panel's P2 reskin (don't touch the
live app either way).
