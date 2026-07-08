/**
 * Unit tests for stick axis threshold + hysteresis — no device / daemon.
 * Run: pnpm exec tsx test-stick.ts
 */
import {
  evaluateStickAxis,
  type StickArmState,
} from "./src/hid.js";

function eq(
  actual: { fire: boolean; state: StickArmState },
  expected: { fire: boolean; state: StickArmState },
  label: string
): void {
  if (actual.fire !== expected.fire || actual.state !== expected.state) {
    throw new Error(
      `${label}: expected fire=${expected.fire} state=${expected.state}, got fire=${actual.fire} state=${actual.state}`
    );
  }
}

// ── pole low (left/up style: value drops toward 0) ────────────────
eq(evaluateStickAxis("armed", 127, "low"), { fire: false, state: "armed" }, "low idle");
eq(evaluateStickAxis("armed", 96, "low"), { fire: false, state: "armed" }, "low near deadzone");
eq(evaluateStickAxis("armed", 64, "low"), { fire: false, state: "armed" }, "low at threshold (strict <)");
eq(evaluateStickAxis("armed", 63, "low"), { fire: true, state: "fired" }, "low crosses → fire");
eq(evaluateStickAxis("fired", 0, "low"), { fire: false, state: "fired" }, "low held no re-fire");
eq(evaluateStickAxis("fired", 50, "low"), { fire: false, state: "fired" }, "low still deflected");
eq(evaluateStickAxis("fired", 95, "low"), { fire: false, state: "fired" }, "low below rearm");
eq(evaluateStickAxis("fired", 96, "low"), { fire: false, state: "armed" }, "low rearm at 96");
eq(evaluateStickAxis("fired", 127, "low"), { fire: false, state: "armed" }, "low rearm center");
eq(evaluateStickAxis("fired", 160, "low"), { fire: false, state: "armed" }, "low rearm at 160");
eq(evaluateStickAxis("fired", 161, "low"), { fire: false, state: "fired" }, "low above rearm stays fired");

// After rearm, can fire again
eq(evaluateStickAxis("armed", 10, "low"), { fire: true, state: "fired" }, "low second fire");

// ── pole high (right/down style: value rises toward 255) ──────────
eq(evaluateStickAxis("armed", 127, "high"), { fire: false, state: "armed" }, "high idle");
eq(evaluateStickAxis("armed", 192, "high"), { fire: false, state: "armed" }, "high at threshold (strict >)");
eq(evaluateStickAxis("armed", 193, "high"), { fire: true, state: "fired" }, "high crosses → fire");
eq(evaluateStickAxis("fired", 255, "high"), { fire: false, state: "fired" }, "high held no re-fire");
eq(evaluateStickAxis("fired", 200, "high"), { fire: false, state: "fired" }, "high still deflected");
eq(evaluateStickAxis("fired", 160, "high"), { fire: false, state: "armed" }, "high rearm at 160");
eq(evaluateStickAxis("fired", 96, "high"), { fire: false, state: "armed" }, "high rearm at 96");
eq(evaluateStickAxis("fired", 95, "high"), { fire: false, state: "fired" }, "high below rearm stays fired");
eq(evaluateStickAxis("armed", 250, "high"), { fire: true, state: "fired" }, "high second fire");

console.log("test-stick: all passed");
