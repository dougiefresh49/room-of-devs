/**
 * Unit tests for triage cycle logic — no device / daemon.
 * Run: pnpm exec tsx test-triage.ts
 */
import {
  nextTriageFocus,
  focusAfterDismiss,
  type HandEntry,
} from "./src/triage.js";

function eq(actual: string | null, expected: string | null, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const hands: HandEntry[] = [
  { sessionId: "a", raisedAt: "2026-01-01T00:00:01Z" },
  { sessionId: "b", raisedAt: "2026-01-01T00:00:02Z" },
  { sessionId: "c", raisedAt: "2026-01-01T00:00:03Z" },
];

eq(nextTriageFocus([], null, "right"), null, "empty right");
eq(nextTriageFocus([], "a", "left"), null, "empty left");
eq(nextTriageFocus(hands, null, "right"), "a", "no focus → right = oldest");
eq(nextTriageFocus(hands, null, "left"), "c", "no focus → left = newest");
eq(nextTriageFocus(hands, "missing", "right"), "a", "stale focus → right = oldest");
eq(nextTriageFocus(hands, "a", "right"), "b", "a → right = b");
eq(nextTriageFocus(hands, "b", "right"), "c", "b → right = c");
eq(nextTriageFocus(hands, "c", "right"), "a", "c → right wraps to a");
eq(nextTriageFocus(hands, "a", "left"), "c", "a → left wraps to c");
eq(nextTriageFocus(hands, "b", "left"), "a", "b → left = a");
eq(nextTriageFocus(hands, "c", "left"), "b", "c → left = b");

eq(focusAfterDismiss(hands, "a"), "b", "dismiss oldest → next");
eq(focusAfterDismiss(hands, "b"), "c", "dismiss middle → next");
eq(focusAfterDismiss(hands, "c"), "a", "dismiss newest → wrap");
eq(focusAfterDismiss([hands[0]], "a"), null, "dismiss last → null");
eq(focusAfterDismiss([], "a"), null, "dismiss empty → null");

console.log("test-triage: all passed");
