/**
 * Unit tests for dnd decision logic — no live process polling.
 * Run: pnpm exec tsx test-dnd.ts
 */
import { decideDndAction } from "./src/dnd.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eq(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const noHold = { active: false };
const manualHold = { active: true };
const dndHold = { active: true, source: "dnd" };

eq(decideDndAction(true, noHold), "hold", "meeting + no hold");
eq(decideDndAction(true, manualHold), "noop", "meeting + manual hold");
eq(decideDndAction(true, dndHold), "noop", "meeting + dnd hold");
eq(decideDndAction(false, dndHold), "release", "no meeting + dnd hold");
eq(decideDndAction(false, manualHold), "noop", "no meeting + manual hold");
eq(decideDndAction(false, noHold), "noop", "no meeting + no hold");

console.log("test-dnd: all passed");
