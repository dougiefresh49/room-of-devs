# Room of Devs — STATUS

The single "where are we" page. Update at the end of every shipped
round; publish to the phone with `pnpm docs:publish`.

_Last updated: 2026-07-30 (RIG prototype P2 — the console — SHIPPED &
deployed; P1 shipped same day)_

## Inbox

Owner drop zone — bugs, findings, ideas, "next I want…". One bullet each,
no format rules. Sessions triage these: bugs → fixes/known issues, ideas →
the backlog, work → `active/` specs or Next up. Empty is the goal state.

- _(empty)_

## Now

> ✅ **THE DESIGN TARGET IS LOCKED: THE RIG.**
> **[active/design-ui-target.md](active/design-ui-target.md)** is the
> system of record for all UI prototype work — visual system (corner
> grammar, hex layer, amber/gunmetal tokens), all surfaces incl. the
> LONG-RANGE PLOT and THE FIELD UNIT (mobile), salience as one
> daemon-computed number, the tap-in + diagram-artifact flows, the
> adopted day-1 cuts, and prototype phases P1–P7.
> Architecture (#73, docs 04–09) remains settled separately.

- **COURSE CORRECTION (2026-07-30, owner):** P1/P2 were executed as
  incremental builds on the LIVE app — that is not what the owner
  wanted from "prototype." A prototype is a **siloed mock-data build**
  (React+shadcn, mock flows/triggers, canned audio ok, no real
  contracts) whose job is to lock the target BEFORE the real UI is
  refactored into shared mobile/desktop components. New system of
  record for the build:
  [spec-rig-prototype.md](active/spec-rig-prototype.md); the target
  §9 phase table is re-scoped to a surface inventory. The P2 console
  reskin stays deployed (legacy deletion + input parity + a real
  daemon fix rode along) but the approach is retired; say the word if
  you'd rather revert the panel to pre-RIG (`git revert 97ab295
  6e0e13e` + redeploy).
- **RIG P2 "the console" SHIPPED & DEPLOYED (2026-07-30)** per
  [spec-rig-p2.md](shipped/spec-rig-p2.md). The panel main window is now
  the RIG console over the existing snapshot — no daemon-surface or
  protocol changes. Landed: the **desktop-only token flip** (`--room-*`/
  `--state-*` re-pointed at the RIG ramp in panel/style.css `:root`;
  mobile untouched until P6; working=amber, needs-you=red,
  speaking=amber-hot, idle=steel-dim, accent=green), **faceplate** (176px
  CRT hero = current speaker else Mikey, talk lamp + waveform, live
  Dial-2 voice chips, transcript screen replacing the summary aside,
  dark "SECOND VOICE // BAY EMPTY" Donnie bay), **thread nodes**
  replacing the AgentCard grid (58px CRT face, callsign + rename,
  S-#### · TMUX ✓, task line, state tags incl. needs-you glow + HOLDING
  timer, grant button, full ActionCluster, PTT spread preserved),
  **open node** (one at a time: `/thread` history via a new Tauri
  `thread_history` command fetching mobile-http with the token, live
  activity line; no fake spend/diff panels), **reply deck** — the two
  input-parity requirements shipped: **desktop typed chat** (composer →
  existing `reply` command; found + fixed the daemon gap where panel-ws
  acked replies without injecting) and **attachments** (paste/drag →
  saved under `~/.cursor/tts/attachments/` via new `save_attachment`
  command → path injected in the reply text) + PTT bar (cold/hot) +
  grant chip, **crew manifest** (lit = persona piloting), **watch-order
  chips** (from `live.on`, click = stand down), static ceremony/turn
  dial chips. Replaced style.css buckets deleted (~520 lines); round-2
  consolidation steps 1–3 formally superseded (doc archived).
  Implementation by grok-4.5-high (worktree lane); main session fixed
  the panel-ws reply wiring and a stacked-layout collapse (narrow
  window clipped the node grid — CSS cascade order). Verified:
  typecheck + fixtures green; codex computer-use round: 8/9 first pass
  (fake-session harness, typed-chat inject proven end-to-end into a
  tmux `cat` sink), layout fix re-verified at 700×700. Day-1 cuts held:
  no plot, no spine rail, no salience ring, no held-question keycaps.
  Known cosmetic debt: avatar art's green background shows through the
  mild CRT grade on the 176px hero (art cleanup already in backlog);
  wide-window layout capped at 1500px but still airy — P3/P4 fill the
  middle with the rail + instruments.
- **RIG P1 "the metal shop" SHIPPED & DEPLOYED (2026-07-30)** per
  [spec-rig-p1.md](shipped/spec-rig-p1.md). Landed: the `--rig-*` token
  vocabulary in `@room/ui` tokens.css (palette/cuts/hex tiles/type/glows
  — added alongside, no existing values changed, so mobile + main window
  untouched), 12 RIG primitives in `packages/ui/src/rig/` (CutFrame,
  Chassis, Bay, ScreenBed, Tag, Led, Keycap, HexLayer, Odometer,
  DialGauge, CrtFace, SalienceBar), a dev-only gallery
  (`pnpm --filter @room/ui dev`, port 5179), and the **dock strip
  reskinned** — gunmetal plate with the corner grammar, CRT-housed
  avatars, interim client-side salience LED bar with red threshold
  notch, scrolling amber ticker, three status lamps. Implementation by
  grok-4.5-high (worktree lane); main session caught + fixed two
  regressions: the NSPanel width math didn't budget the new instrument
  row (would have clipped it — step 44→58, height 126→144,
  DOCK_SCR_WIDTH added) and the ticker marquee was invisible most of
  its cycle (seamless-marquee rewrite). Verified: typecheck +
  check-fixtures green, gallery inspected (all primitives + corner
  grammar), codex screenshot-proofed the dock (no clipping; ticker
  motion shown in two timed captures; main window confirmed un-tinted).
  **Owner sign-off on the target recorded 2026-07-30** ("looks good…
  go ahead"), with the craft-naming correction folded in: a card/blip =
  the SESSION working a task, never the task; "craft" marked
  provisional. **Next: P2 — the console** (panel main window over the
  existing snapshot).
- **DESIGN TARGET WRITTEN — signed off 2026-07-30 (2026-07-29)**.
  Stage 1 of [prototype-kickoff-prompt.md](active/prototype-kickoff-prompt.md)
  is done: `design-ui-target.md` distills the approved v6 RIG board +
  v5 mobile board + briefs + #73 architecture into one buildable spec.
  The v6 closing corrections are honored: the hex spend core is renamed
  **THE CORE** (not "harvester" — the tower is the harvester; the word
  stays available for the spine), and the two unshown flows are specced
  (**tap-in** — both ask-the-room via the tap-in.ts assembly and
  look-into-a-craft; **"let me see a diagram"** — one-off → versioned
  Mermaid artifact → docked artifact card → summary-pane render).
  Salience is specced as `AgentViewSchema.salience` (0–100 "% clear") +
  a top-level threshold, with a v1 heuristic that needs NO tracker join
  — so the ring/plot light up before #75. Phases: P1 tokens+corner
  grammar (`packages/ui`, dock reskin) → P2 console → P3 salience+plot
  (first daemon change) → P4 spine mirror → P5 reply deck+tap-in →
  P6 mobile → P7 artifacts+verbs. **On your sign-off, P1 starts**
  (spec-ui-consolidation-round2 steps 1–3 are superseded by P2's
  re-spec).
- **ROUND C PLAY ARC CLOSED — THE RIG refined board APPROVED
  (2026-07-29, owner: "I like it")**. Closing corrections recorded at
  the bottom of
  [design-brief-round-c-v6.md](active/design-brief-round-c-v6.md) and
  folded into the target above.
- **Round C v6 — THE RIG PICKED; cohesion pass, approved same day
  (2026-07-29)**. Owner on the play arc: *"I like both but really like
  THE RIG the most"* — industrial lane wins; BLACK // GLASS preserved
  for a future theme system (backlogged). Owner supplied real Titanfall
  refs (`concepts-round-c-v6/refs-titanfall/` — Briggs faceplate corner
  clips, Archer scope chamfers, harvester hex shell, energy tower,
  map-callout key, frontier starmap); notes captured in
  **[design-brief-round-c-v6.md](active/design-brief-round-c-v6.md)**:
  spine must read as one machine (holo cards docked/projected, not "a
  grey bay and cards next to it"), asymmetric corner grammar, hex
  texture layer, harvester concept, radar plot confirmed keep.
  - **[THE RIG — refined](https://ib8n7y2c05z4.postplan.dev)** (group
    `room-of-devs/round-c-v6`): spine is now an energy tower (beam
    core, hex shields, docking track) with plans clamped on via dock
    bosses + projection stems — light for live work, metal for
    settled; one corner grammar (big radius top-left + chamfer
    bottom-right, echoed at 3 scales); hexes as texture only; the
    harvester became the spend instrument (lit shell fraction = month's
    draw, core pulse = current burn); map-callout leader lines; one
    "FUTURE: 10,000-FT VIEW" annotation (not built).
  - Backlogged (ideas-backlog.md, owner's call — not day 1): the
    **10,000-ft starmap view** (spine as origin, tickets as ships,
    phases as planets, destination name TBD) and **theme switching**
    (round-C boards all committed as resurrection material).
  - Round-C docs checkpoint committed: `e4f6e56`.
- **Round C CONCEPT ROUND v5 — MOBILE, 2 boards, owner verdict: both
  liked, RIG preferred (2026-07-29)**. Owner on v4: *"looks awesome, I'm really liking both
  lanes"* — no corrections, both aesthetics locked-in-play.
  **[design-brief-round-c-v5.md](active/design-brief-round-c-v5.md)**
  reframes mobile: NOT a shrunk desktop — the phone's ranked jobs are
  be-spoken-to → answer-from-the-pocket → glance → start-work-by-voice,
  with "walk to the Mac" an honest handoff for heavy surfaces
  (supersedes v2's "mobile deliberately thin"). Both boards: 6
  phone-frame screens, thumb-reach annotations, grounded in the real
  mobile SPA bones (SSE RoomClient, one audio adapter, speaker gate),
  inventions flagged in the cut panels.
  - **[THE RIG mobile](https://9orx1jbxt4zd.postplan.dev)**:
    fixed-camera polar plot (tap a blip → cut to thread, no pinch
    camera), thumb-size held-question keycaps with the armed key =
    Mikey's spoken recommendation, lock-screen notification frame,
    STOP + hold-to-duck listening, speakable verb rack,
    walk-to-the-rig handoff on spend/dials.
  - **[BLACK // GLASS mobile](https://jlcnqhnh1i9a.postplan.dev)**:
    *salience becomes gravity* — portrait sky where YOU sit above your
    thumb and craft FALL toward the threshold ring as they near
    needing you; warm lock card, grant chip
    (`AUDIO GRANT · phone · you · 0:24`), route chip making the
    speaker gate legible, one-thumb-reach arc drawn on the glance
    screen.
  - Group: `room-of-devs/round-c-v5`. Honest-cut highlights both
    flagged: phone-mic STT and lock-screen push are inventions beyond
    today's SPA (v1 answers by keycap+text; audio IS the
    notification).
  - **NEXT: owner reacts to v5 → settle all play rounds (v3+v4+v5)
    into a real design target** — that's the exit from the world of
    play into prototyping.
- **Round C CONCEPT ROUND v4 — feature build-out, 2 boards, owner
  verdict: "looks awesome, really liking both lanes" (2026-07-29)**. Owner on v3: *"I like them both a lot"*
  — BOTH lanes survive; v4 is additive in each board's own language per
  **[design-brief-round-c-v4.md](active/design-brief-round-c-v4.md)**.
  Added everywhere: **replying** (text inject, PTT with a visible grant
  chip, held AskUserQuestion options answerable by click or voice), the
  **zoomed-out space map** (owner's ask — everything in flight, thread
  distance = salience, threshold visible at map scale, zoom ladder
  map ↔ rail/room ↔ node), **starting work** (concierge intake +
  saved-verb shelf, newborn thread materializing), the **three dials**
  (ceremony/voice/brain-tier) with visible homes, and a
  **thread/persona legend** fixing the v3 confusion ("a face is a
  persona; a card is a mortal thread wearing it").
  - **[THE RIG v4](https://tkp7ee1qlpld.postplan.dev)**: LONG-RANGE PLOT
    (polar salience cartography, radar sweep, archived plans as
    derelicts), REPLY DECK on one interpreter rail, machined amber
    option keys on Splinter's held question, pilot-roster legend, verb
    rack with watcher verbs visibly gated on #75.
  - **[BLACK // GLASS v4](https://4nomjorqlcok.postplan.dev)**: orbital
    chart reusing the salience threshold ring at map scale (nothing
    plotted twice), grant chip with owner/device/countdown, sleeve
    legend at all three zoom scales, interpreter classification readout
    on intake.
  - Group: `room-of-devs/round-c-v4`; v3 stays up for comparison. Both
    updated their "what I'd cut" panels for the new features.
  - **NEXT: v5 = MOBILE concept rounds** in both lanes (owner's ask,
    same world-of-play footing) after the owner reacts to v4 — still no
    prototyping until the play rounds settle.
- **Round C CONCEPT ROUND v3 — reference-seeded, 2 boards, superseded by
  v4 same day (2026-07-29)**. Owner verdict on v2: better, still missing
  the mark. Couldn't find usable screenshots from the media in mind
  (Altered Carbon, Foundation, Halo, Titanfall 2), so we generated the
  references instead: **Nano Banana Pro fragment images** (5 UI pieces ×
  2 style lanes, ~$1.30 Gemini spend) that the owner reacted to before
  any HTML was written. Owner's industrial notes (machined chrome
  sparingly, data on digital displays, don't chase 3D) are binding in
  **[design-brief-round-c-v3.md](active/design-brief-round-c-v3.md)**;
  downscaled refs live in `concepts-round-c-v3/refs/`.
  - **[THE RIG](https://s6fg1wv3k1v4.postplan.dev)** (Lane A —
    industrial / Titanfall 2): gunmetal chassis at corners + two hero
    housings only, amber instruments carry all data; spine as a machined
    rail of blueprint plan-cards with threads as terminal nodes on
    animated conduits; Salience Ring with threshold tab; voice
    subscription as a WATCH ORDER chip.
  - **[BLACK // GLASS](https://qpfxzv23bs85.postplan.dev)** (Lane B —
    clean cyber / Altered Carbon + Foundation): light is the only status
    system; salience threshold ring with drifting thread dots as the
    interrupt policy; TMNT frames mounted in machined-glass faceplate
    housings; spine as a vertical light column with glass plan slabs.
  - Group: `room-of-devs/round-c-v3`. Both boards self-contained, all 7
    animated avatars, "what I'd cut" panels included. Fragment
    generation pipeline: scratchpad `genfrag.py` (rerunnable for more
    pieces/lanes).
- **Round C CONCEPT ROUND v2 — FUTURIST, 4 boards, AWAITING YOUR REACTION
  (2026-07-29)**. Round 1's boards were rejected by the owner: *"text
  heavy, nothing incorporates the avatars, pure 2014, those designs say
  task manager — I can just tie stuff to Linear for that."* **The brief
  was the bug**, not the agents: it said *work board / status surface /
  work item / ledger* and added a tiebreaker rewarding designs that
  needed no new backend. That reads as "draw me a cheap Trello."
  - **[design-brief-round-c-v2.md](active/design-brief-round-c-v2.md)**
    rewrites it around what the product actually is — an **animated
    character on top of an agentic workflow, visual and voice first**.
    The cost tiebreaker is REVOKED (it suppressed the wanted ambition);
    every board instead ships a *"what I'd cut to rein it in"* note.
    "Live" is re-specced as a spoken subscription ("keep me posted on the
    prod bug"), not a mode. Mobile is deliberately thin — owner is still
    thinking.
  - **Avatars are now unavoidable**: real TMNT frames downscaled to
    51KB of data URIs with working CSS lipsync + blink, shared via
    `concepts-round-c-v2/_avatar-frames.css`. Every board embeds all 7.
  - **Four blind boards, high-taste models only** (Opus + Fable; Grok and
    Sol dropped on taste), each seeded a different visual direction so
    they can't converge:
    [FACEPLATE](https://ewje7vmln140.postplan.dev) (the window IS Mikey's
    field of view; motes placed by how close they are to needing you;
    salience threshold is a draggable ring) ·
    [THE DEEP](https://llsb1sfdqflg.postplan.dev) (wildcard — a lit cabin
    over black water; depth = distance from wanting you; settling is
    sinking; spend is hull pressure) ·
    [APPROACH](https://w6ad33cdskq6.postplan.dev) (airspace over done;
    craft descend toward a SETTLED pad; waiting = amber holding pattern) ·
    [THE BRIDGE](https://30krq7pmdrs8.postplan.dev) (one station, every
    gauge real; live stdout as the honored guest; no invented telemetry).
    Group: `room-of-devs/round-c-v2-futurist`.
  - **The finding worth keeping**: all four independently made *distance
    from you* the organizing quantity — threshold ring / depth / altitude
    — and all four want the daemon to compute it as ONE number in the
    snapshot. That's the salience filter with a number attached, and it's
    the cheapest shared dependency across every design.
  - Round 1 boards + pick matrix retained for reference (rejected
    aesthetic, useful decision rows): group
    `room-of-devs/round-c-concepts`.
- **Round C concept round v1 — REJECTED (2026-07-28)**, kept for the
  decision rows only. Course correction, owner's call: a design target was
  drafted and briefly locked, but locking an exact target *before* a
  concept round makes every board the same board. So the target was
  un-locked and split in two:
  - **[active/design-brief-round-c.md](active/design-brief-round-c.md)** —
    the LOCKED brief. Explicitly separated into "do not re-litigate"
    (the #73 layering, the ten anti-goals as screen tests, the three
    dials needing homes, hard technical invariants, input parity) and
    "WIDE OPEN" (the shape of every surface, the concierge's presence,
    how work reads, the salience surface, the cost readout, the artifact
    loop, material/voice, what to cut). Primary object is a **strong
    default you may challenge but must beat**, not a lock.
  - **The former target became a competing entry**:
    `concepts-round-c/candidate-a-work-item.md`.
  - **Four blind boards** drawn against that brief, forbidden from
    reading each other:
    [Opus "The Settle Line"](https://vbjkjmx9o5dx.postplan.dev) ·
    [Fable "The Quiet Floor"](https://qtefoaplf7gt.postplan.dev) ·
    [Sol "Signal Desk / Ledger"](https://1i2xbi1gzsv1.postplan.dev) ·
    [Grok "Signal Desk / Tray"](https://hxlruxym71vp.postplan.dev).
    (Sol and Grok hit the same name independently — Sol's transcript
    shows no read of Grok's file.) Each names its concept, covers all
    three surfaces in load-bearing states, prices any subsystem it
    invents, and self-checks against the ten anti-goals.
  - **[PICK MATRIX — start here](https://sup7lp3bb68r.postplan.dev)**:
    19 decision rows across all five entries, one tradeoff line per
    cell, unanimous rows flagged as skippable, and the **six rows that
    actually matter** called out. All grouped on the Postplan dashboard
    under `room-of-devs/round-c-concepts`.
  - **Notable**: the brief's "no new backend wins" tiebreaker does NOT
    discriminate — all five need the same three pieces (salience router,
    spine mirror, cost rollup), two of which are already committed
    architecture work. The sharpest fork is Grok vs the other four on
    whether the durable work ledger belongs in the middle of the window
    at all; it shows up in their own anti-goal self-checks (three named
    #7 "no orchestrator runtime", Grok alone named #1).
  - **Next**: your picks → `design-ui-target.md` written from the
    winning mix → React+shadcn mock → build steps 0–3. Routing note:
    Fable's Anthropic 7-day quota hit 98%, so that board ran via Cursor
    and Sol via Codex.
- **Spine VALIDATED (2026-07-28)** —
  [architecture-concepts/09](active/architecture-concepts/09-spine-validation.md).
  The first build item out of #73, run and graded. **The state vocabulary
  is live on the tracker**: 7 `state/*` + 3 `gear/*` labels, applied to
  all open issues and 7 settled ones (`type/*` deliberately not created).
  Free harness: `tts-server/scripts/tap-in.ts` (assembles the spine, asks
  flash-lite, emits one cost line per call — the seed of the brain-tier
  cost log; `--dry` prints the context and makes no API call, free
  forever). Graded 11 questions twice, harshly: **5✅/3~/3❌ → 7✅/4~/0❌**
  after pre-computing the roll-up deterministically, at $0.0019 and ~1.5s
  a turn. Total spend for the whole experiment: **under 4 cents**.
  - **Zero retrieval failures in either pass** — every miss had its
    evidence in the context window. Dumping the whole spine is the right
    assembly strategy at this size, and **ContextDB stays parked** (its
    trigger is retrieval failing; retrieval never failed).
  - **It refused the question whose answer isn't in the spine** and named
    where the answer lives, in both passes. The confabulation failure
    mode never fired.
  - **Lesson worth keeping**: the first re-grade was *worse* than
    baseline because the new deterministic resolver fed the model
    confident noise. A confidently wrong deterministic input is more
    damaging than a vague prose one, because the model defers to it.
  - **Gate lifted for tracker-derived roll-ups** (what shipped + what
    verified it, what's waiting, what's blocked, which ticket do you
    mean, is anyone working) — safe for interpreter Stage 2 at flash
    tier. **Still gated**: STATUS-prose roll-ups ("what's next up, in
    order") — a code-shaped gap, not a model limit. Frontier escalation
    shrank from 3 turn classes to 1 (`recommend`/`prioritize` — judgment,
    not aggregation).
  - **Watcher threads stay hard-gated**, now narrowly: liveness is
    answered by a transcript-freshness heuristic, but alerts can't yet be
    joined to a ticket. Un-gate when a mid-flight tap-in names the thread
    *and* its ticket. Blocker filed as **#75** (file-at-start +
    claim-at-start write-back) — needs an owner decision, since it
    changes how every delegated thread behaves.
- **#73 CLOSED — architecture target picked (2026-07-28)**: concept
  diagrams in [active/architecture-concepts/](active/architecture-concepts/)
  (00–08: legend, current state, George's framework, layerings A/B/C,
  generalized model, rooms/brains/watchers, scenario flows, NOT-building
  list, spine mechanics; all phone-rendered via docs:publish, which now
  renders Mermaid → SVG at build time). **Picked: Option B as generalized
  in docs 04–05** — one always-on concierge voice (Mikey) above the
  interpreter line; the task manager (GH issues) is the spine/durable
  mind; N mortal orchestration threads (build / one-off / watcher) pulled
  from it; silent ephemeral workers; three dials (ceremony per thread,
  voice attachment incl. 1:1 checkout, brain tier per turn — a routing
  table + cost log, never model-self-assessed); rooms = per-project
  manifest (cast + spine + default gear) when project #2 joins; saved
  verbs added by conversation (stacked for later design review).
  George's review folded in 2026-07-28: manifest wording, routing-table
  brains, sentinel→watcher rename, and watchers hard-gated on spine
  validation. Rejected: Mikey-as-orchestrator (measured cost +
  mortality), three-voice huddles (memo beats meeting), voice+KB chatbot
  shape. **Round C re-cut**: the design target is no longer "a room of
  talking workers" — it's one voice you can always talk to cheaply, a
  status surface for silent threads/tickets underneath, and an artifact
  loop for diagrams. Round C steps 0–1 (shadcn wiring, component dedup)
  unaffected; the design-target lock and board picks now evaluate against
  docs 04–07.
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
  [archive/spec-ui-consolidation-round2.md](archive/spec-ui-consolidation-round2.md)
  (steps 1–3 superseded by RIG P2, 2026-07-30; step 0 + command seam
  remain unclaimed backlog).
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

1. **Keep or revert the P2 panel reskin?** It stays deployed for now
   (desktop typed chat, attachments, and the reply-inject daemon fix
   are real keepers regardless); if you'd rather the live panel go
   back to pre-RIG while the prototype locks the target, say so —
   `git revert` + redeploy, ten minutes. Also still open: a better
   word than "craft".
2. **Does mobile Talk absorb live mode?** Carried forward from candidate
   A. Deferrable, but must not be lost — it is the only decision that
   *deletes shipped behavior*, and one board silently assumes "yes".
3. **#75 — file-at-start + claim-at-start write-back.** Changes how every
   delegated thread behaves (CLAUDE.md, possibly the hooks), so it wasn't
   done unilaterally. Watcher threads stay gated until it lands.
4. **Optional overrule: the tape.** Killed in candidate A and not
   resurrected by any of the four boards — five independent designs all
   let it go. Say so if scrubbing was the part you actually wanted.

(Cleared 2026-07-27: live mode v2 retest — done; arcade button
bring-up #16 — done; Round A second-device LAN check — verified working;
mic TCC dropped as a tracked item — it's the one-time macOS microphone
permission prompt that fires on first panel PTT recording, self-serve.)

## Next up (likely order)

0. **THE RIG standalone prototype** per
   [spec-rig-prototype.md](active/spec-rig-prototype.md) — siloed
   React+shadcn app, mock snapshot + scenario triggers, ALL target
   surfaces (spine rail, plot, salience ring, CORE, reply deck with
   keycaps, verb rack — none of which the live app can render yet
   because their data doesn't exist). Lock flows/interactions there,
   then work backwards to the daemon/wire changes and the shared
   mobile/desktop component refactor.
1. **Spine follow-ups** (all cheap, all optional, none gating Round C):
   parse STATUS's ordered "Next up" into the tap-in digest (closes the
   last roll-up gap); build the one-`state/*`-per-issue lint (#75 filed
   itself misfiled, which is the argument for it); add the
   `recommend`/`prioritize` routing-table entry with cost logging.
2. **Conversational layer** ("dev in the room") — consensus design:
   [active/design-conversational-layer.md](active/design-conversational-layer.md);
   **Stage 1 build spec ready**:
   [active/spec-interpreter-stage1.md](active/spec-interpreter-stage1.md).
3. **Phone image attachments** in live mode.
4. Cross-persona spawn race + subagent-finish announce filtering (small
   daemon fixes — see backlog).

## Someday

See [reference/ideas-backlog.md](reference/ideas-backlog.md) — cmux
evaluation, Android wrapper app, mobile lip-sync, multi-agent conference
mode, Donnie avatar art cleanup, and more.

## Recently shipped

| When       | What                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 2026-07-30 | **RIG P2 "the console" shipped** — panel main window is the RIG console (token flip desktop-only, faceplate + Donnie bay, thread nodes + open-node history, crew manifest, watch chips); input parity landed: desktop typed chat (incl. the panel-ws inject fix) + attachments; ~520 lines of legacy style.css deleted |
| 2026-07-30 | **THE RIG: design target locked + P1 "metal shop" shipped** — design-ui-target.md signed off; --rig-* tokens, 12 RIG primitives + gallery in @room/ui, dock strip reskinned (salience LED bar, ticker, lamps); verified via gallery + codex dock screenshots |
| 2026-07-28 | **Spine validated + Round C concept round** — `state/*`+`gear/*` labels live on the tracker, free `tap-in.ts` harness, 11 questions graded twice (0 wrong answers after deterministic roll-up, <4¢ total); design brief locked and 4 blind concept boards + pick matrix published |
| 2026-07-28 | **#73 architecture concepts** — target layering picked (docs 00–07 in active/architecture-concepts/); docs-publish renders Mermaid → SVG; dock-runaway regression filed as #74 |
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
