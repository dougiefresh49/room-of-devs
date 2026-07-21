# V2 concept + spec review

## Complaint coverage

### GPT concept
1. **Answered:** compact 68px row; small left avatar, adjacent identity, right-side live/collapse.
2. **Answered:** one-line auto-growing composer, inline send, no Cancel.
3. **Answered:** idle controls disappear; playback gets a 48px strip only while active.
4. **Answered:** history visibly contains both owner and agent turns.
5. **Answered:** live is an isolated call surface; typing moves to chat while live persists.
6. **Answered:** working state exposes free, transcript-derived tool activity.

### Grok concept
1. **Answered:** compact row replaces the hero stack, though collapse is placed far left rather than with the right-side controls.
2. **Answered:** one-line growing input and same-row send, no Cancel (send/mic are adjacent rather than inside one input shell).
3. **Answered:** transport is absent at idle and becomes a slim active-only strip.
4. **Answered:** both sides are shown in the thread.
5. **Answered:** call and chat are separate sliding panels; keyboard exists only in chat.
6. **Answered:** working state shows visual-only tool activity.

## Concept weaknesses

### GPT (my concept)
- The call dock has an unexplained audio-output/broadcast button. That reads as transport and weakens the brief's “End live. One button” rule.
- Its 92px call avatar is less presence-led than the requested/spec'd ~120px avatar; the dense three-row activity card also feels more like a monitor than Sesame calm.
- The call-to-chat motion runs in the opposite spatial direction from the owner's reference: call retreats right and chat returns from the left.

### Grok
- Speaking state shows an intermediate card **plus** a “Still editing” pill, breaking the one-current-thing model.
- Working uses a terminal-like three-line feed rather than one calm current-result card; this invites accumulation and scanning.
- The live-chat pin plus a second full identity header consumes two rows—the exact stacking pressure this redesign is meant to remove.

## Spec A–C review

- **A1:** “final = next non-sidechain entry is user or EOF” is ambiguous across tool results and consecutive assistant entries; define the exact look-ahead algorithm and fixtures. Also specify safe `sessionId` validation, ordering/deduping when `/thread` is merged with SSE, and behavior for malformed/truncated JSONL.
- **A1/B1:** replay matching by `rawText/spokenText` prefix can attach the wrong clip to repeated/long messages. Return or derive a stable turn/message ID instead.
- **A2 vs concepts:** the server exposes only one `lastActivity`, but both concepts render activity history. Either change UI to current label + `toolCount` (as B2 says) or specify a bounded activity array.
- **A2:** no lifecycle is defined for clearing stale activity at turn start/final/live-off; an old tool label can masquerade as current work. Command/detail redaction and atomic/concurrent writes to `live_sessions.json` are also unspecified.
- **B1:** both concepts' playback strips omit the required close `×` and show title/time/progress rather than the specified karaoke-current-words line. Pick one contract before implementation.
- **B2:** define precedence among speaking, activity, final, and idle when updates race; define whether End live immediately pauses/clears phone audio before navigating. The slide direction also conflicts with the brief's call-slides-left reference.
- **B2:** “credits · N clips” needs a named source/reset rule; A exposes `toolCount`, not synthesized-clip count. Do not approximate credits from tools.
- **C:** specify when the phone chip clears (frame end, live-off, stale timeout) and how overlapping ack/live/Mac frames resolve. Add reducer-level tests for pendingGrant/spotlightEnterKey, not only a screenshot.

## Verdict

Build the **GPT information architecture and single-card call composition**, but use Grok's larger avatar and simpler symmetric end/timer/text dock. Remove GPT's audio-output button, remove Grok's second activity pill and duplicate live-chat header, drive working UI from one current activity + count, and settle the strip/data/state contracts above before coding.
