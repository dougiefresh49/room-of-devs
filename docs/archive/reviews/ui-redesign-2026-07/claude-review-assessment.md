# Assessment of the opus5 claude-review round (2026-07-25)

Fable-5 session assessment of the three opus5 boards in the postplan group
`room-of-devs/ui-concepts/claude-review`, archived here as:

| File | Postplan draft | What it is |
| --- | --- | --- |
| `claude-review-verdict.html` | 1x792690909r | Critique of the four final boards; 8 forks decided; 5 gaps named |
| `claude-review-reused-room.html` | n6vcbzngqrio | Concept A — assembled strictly from the four boards, every part cited |
| `claude-review-over-the-shoulder.html` | ei9da1em3m6p | Concept B — opus5's own divergent design |

Disclosure: the "Den" board opus5 ranks highest on taste was authored by
fable-5, the same model family writing this assessment — weight its
agreements accordingly.

## Verdict on the verdict

The review is the best single document the program produced. The
eight-fork table is a usable decision record, and the five gaps are the
most valuable part — especially GAP 01 (interruption designed at the
wrong layer) and GAP 03 (ink-timed-to-speech is an unpriced subsystem).

## Where opus5 is right (adopt)

- **The interrupt ladder (steer / stop / aside)** is the real
  contribution and the feature the owner said was missing. It is grounded
  in actual mechanics: Claude Code delivers queued user input between
  tool calls (steering is native behavior), `live-tail.ts` already sees
  tool-use boundaries, `inject_prompt.sh` is the delivery vehicle.
  "If the boundary is unknowable, the product says aside and means it"
  is the right contract.
- **The work pane over the empty Table.** All four boards centered a
  canvas justified only by unbuilt futures (glance, napkin, huddle,
  paste). Files touched / diff so far / last command all live in the
  transcript JSONL the daemon already tails. Load-bearing on day one.
  Caveat: only covers Claude Code sessions; cursor-agent/codex delegates
  won't populate it.
- **The whiteboard as `.room/whiteboard.md`.** Markdown co-authoring
  with git history plays to what four LLMs are already excellent at;
  freehand timed strokes is a research project. "Agents point, you draw"
  is the honest asymmetry.
- **Budget as a ceiling, not a breadcrumb.** Most aligned of anything in
  six boards with the repo's first rule (API credit efficiency). Note
  `elevenlabs.ts fetchCredits()` is caller-less and waiting for exactly
  this.
- **Keep the thread view, kill thread storage.** The four boards
  conflated a data-model decision (one tape, thread = query) with
  deleting a shipped phone screen.
- **Anchors over ink-timed-to-speech.** Extract `file:line` from raw
  text pre-Gemini-rewrite, highlight while the clause plays, move on
  scrub. ~10% of the machinery for most of the feeling.
- **Build order** (politeness ladder → interrupt ladder → work pane →
  anchors; glance deliberately deferred) is sorted by value-per-effort
  and is correct. The first two are daemon-only and spend nothing.

## Where opus5 overreaches (push back)

- **The "fate prediction" UI races.** Showing "↝ steer · he's between
  tool calls" *before key release* can be wrong by the time injection
  lands. The after-the-fact receipt ("landed before his next tool call")
  is buildable and great; the pre-release prediction should be a
  likelihood, or dropped — otherwise it becomes exactly the
  "believe you steered when you only queued" failure the board warns
  about.
- **Convergence is overweighted as evidence.** "Four independent models
  agreed" ignores that the rounds were iterative over shared
  prior-round material and the models share training data. Partly
  signal, partly homogenization; "settled, stop re-litigating" is
  stronger than the evidence for several chips.
- **The Mac panel is underrated.** "The Mac already has a terminal"
  elides that the panel is the PTT/grant and decision surface, not a
  watching surface. Phone-first as a *design order* is right; "the Mac
  is the echo" as a status claim goes too far.
- **The murmur** (3% ambient bed) ships off with a kill criterion,
  which is the right way to ship a taste bet — but expect the criterion
  to fire. Don't spend an early slot on it.
- **Stable-rail nit:** "hot seats expand in place, nothing changes
  position" isn't quite true — expansion pushes seats below it. Order
  stability is the win; position stability is oversold. (The stable rail
  itself — Workbench's minority call — is still the right pick.)

## Net

The verdict's eight-fork table plus Over the Shoulder's build-order items
1–4 (politeness ladder, interrupt ladder, work pane, anchors) form a
coherent, mostly-free next round, with the budget ceiling jumping the
queue given the credit rules. Glance deferral accepted.
