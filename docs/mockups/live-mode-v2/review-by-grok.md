# Live-mode v2 concept review (Grok)

## 1. Owner complaints #1–#6

| # | Complaint | GPT | Grok |
|---|-----------|-----|------|
| 1 | Compact header (not stacked hero) | Yes — 68px row, av L / Go-live+collapse R | Yes — row, but collapse sits LEFT like a back affordance |
| 2 | 1-line grow input, inline send, no Cancel | Yes | Yes |
| 3 | Hide transport unless playing | Yes — 48px strip only in B | Yes — slim strip only in B |
| 4 | Both-side history | Yes | Yes |
| 5 | Live not stacked on one screen | Yes — rail slide; keyboard only on chat | Yes — panel slide; live-pin on F |
| 6 | Dead-air / invisible tools | Yes — activity inside working card | Yes — feed + pill |

Missed / soft misses:
- GPT: call dock right control is “Audio output,” not “Send a text”; text entry is a floating chip — diverges from brief/spec bottom row (End · timer · Send a text).
- Grok: state D shows karaoke card *plus* activity pill (Sesame-ish, but brief “ONE card” is stricter than GPT’s pure swap).
- Both: playback strip lacks the spec’s × dismiss; neither demos idle-in-live after final beyond E.

## 2. Weaknesses (2–3 each)

GPT: (1) Dock/right control + floating “Send a text” fight the Sesame/spec control grammar. (2) Top credit chip + name under avatar + large focus card feels busier than Sesame’s near-empty call. (3) Mid-call chat keeps full Go-live header under the live-chatbar — double chrome.

Grok (mine): (1) F stacks live-pin *and* a left collapse that reads as a second back. (2) D’s card+pill can clutter short viewports vs GPT’s single focus card. (3) Credits “~2 clips” is decorative; strip has no × / karaoke one-liner from §B1.

## 3. Spec A–C (gaps / contradictions / risk)

- **A2 vs concepts:** only `lastActivity` (+ toolCount). Both mockups show multi-line rolling feeds — implementers will invent client history or under-deliver vs concepts. Spec should say: show current label only, or accumulate N lines client-side from SSE.
- **B1 vs B2:** “working row in-thread” during live vs call-view activity card — which surface owns working when call is up / mid-slide F? Underspecified; risk of duplicate or empty working UI.
- **B1 strip:** requires karaoke one-liner + ×; neither concept models it — easy to ship pause-only and miss dismiss.
- **B2 cost chip “near the timer”:** GPT top chip / Grok name-chip both contradict; pick one before build.
- **B2 End live = stop audio:** clear; GPT’s extra audio button invites a second stop path — don’t ship it.
- **A1 `final` rule:** subtle (hold-one mirror); wrong classification → play chips / card dim vs full wrong. Needs a fixture example in verification.
- **C:** solid; only risk is other non-Mac `output` values — confirm phone is the only off-stage route.

## 4. Verdict

**Build Grok’s skeleton:** call dock (End · timer · Send a text), large presence avatar, edge glow + name-chip credits, F live-pin (back / chip / End), chat default with bubble plays + slim strip. **Steal from GPT:** stricter one-card body while speaking (pill under card optional, Sesame-small), circular send-in-shell composer, explicit “activity = free” copy on working. Drop GPT’s audio-output control and floating text chip. Resolve A2 feed depth + B1×/karaoke strip + cost-chip placement in the winning mockup before coding §B.
