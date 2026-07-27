/**
 * CommandPlan — ordered multi-step intents with stop-on-failure,
 * idempotency, and a confirmation gate on destructive/terminal steps.
 */
import { spawn } from "child_process";
import { join } from "path";
import { TTS_DIR } from "../config.js";
import { log } from "../logger.js";
import { type Action, speakableName } from "./rule-router.js";

const SCRIPTS_DIR = join(TTS_DIR, "scripts");
const SYNC_SCRIPT_TIMEOUT_MS = 10_000;

/** Local step result (mirrors protocol CommandResult semantics, minus wire envelope). */
export interface StepResult {
  ok: boolean;
  code?: string;
  message?: string;
}

export interface CommandPlan {
  id: string;
  steps: Action[];
}

export interface PlanRunResult {
  ok: boolean;
  results: StepResult[];
  /** True if a destructive step armed a pending confirmation and halted. */
  awaitingConfirmation?: boolean;
  /** Remaining steps including the destructive one, when awaitingConfirmation. */
  remaining?: Action[];
  /** Human label for the confirmation prompt. */
  confirmLabel?: string;
  floorHeld: boolean;
}

const completedPlanIds = new Set<string>();

export function markPlanCompleted(id: string): void {
  completedPlanIds.add(id);
}

export function wasPlanCompleted(id: string): boolean {
  return completedPlanIds.has(id);
}

/** Stage 1 destructive set: injected /clear, kill, exit. */
export function isDestructiveAction(action: Action): boolean {
  if (action.kind !== "slash_command") return false;
  const n = action.command.toLowerCase().replace(/^\//, "");
  return n === "clear" || n === "kill" || n === "exit";
}

/** Actions that own the floor — coordinator must NOT un-duck after these. */
export function isFloorHoldingAction(action: Action): boolean {
  switch (action.kind) {
    case "grant":
    case "pause":
    case "stop":
    case "replay":
    case "mood":
    case "hold_room":
    case "release_room":
      return true;
    default:
      return false;
  }
}

export function analyzePlan(steps: Action[]): {
  steps: Array<{ action: Action; destructive: boolean }>;
  needsConfirmation: boolean;
} {
  const annotated = steps.map((action) => ({
    action,
    destructive: isDestructiveAction(action),
  }));
  return {
    steps: annotated,
    needsConfirmation: annotated.some((s) => s.destructive),
  };
}

function scriptEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TTS_DIR };
}

/** Awaitable script run with the same 10s SIGKILL cap as commands.runScriptSync. */
export function runScriptAsync(name: string, args: string[]): Promise<StepResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: StepResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(join(SCRIPTS_DIR, name), args, {
        stdio: "ignore",
        env: scriptEnv(),
      });
    } catch (err: any) {
      settle({
        ok: false,
        code: "spawn_failed",
        message: err?.message ?? String(err),
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      settle({
        ok: false,
        code: "timeout",
        message: `${name} timed out after ${SYNC_SCRIPT_TIMEOUT_MS}ms`,
      });
    }, SYNC_SCRIPT_TIMEOUT_MS);

    child.on("error", (e) => {
      clearTimeout(timer);
      settle({ ok: false, code: "spawn_error", message: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        settle({ ok: true });
      } else {
        settle({
          ok: false,
          code: "exit",
          message: `${name} exited ${code ?? "?"}`,
        });
      }
    });
  });
}

export type StepExecutor = (
  action: Action,
  opts: { inPlan: boolean },
) => Promise<{ result: StepResult; floorHeld: boolean }>;

/**
 * Run plan steps sequentially. Stops before a destructive step and reports
 * awaitingConfirmation so the coordinator can arm the confirm gate.
 * Injects inside a plan use inject_prompt.sh --now (caller/executor decides).
 */
export async function runPlan(
  plan: CommandPlan,
  executeStep: StepExecutor,
): Promise<PlanRunResult> {
  if (wasPlanCompleted(plan.id)) {
    log("interpreter", `plan ${plan.id}: idempotent skip (already completed)`);
    return { ok: true, results: [], floorHeld: false };
  }

  const results: StepResult[] = [];
  let floorHeld = false;

  for (let i = 0; i < plan.steps.length; i++) {
    const action = plan.steps[i];
    if (isDestructiveAction(action)) {
      const label =
        action.kind === "slash_command"
          ? speakableName(action.target ?? "that session")
          : "that session";
      return {
        ok: false,
        results,
        awaitingConfirmation: true,
        remaining: plan.steps.slice(i),
        confirmLabel: label,
        floorHeld,
      };
    }

    const { result, floorHeld: held } = await executeStep(action, {
      inPlan: true,
    });
    results.push(result);
    if (held) floorHeld = true;
    if (!result.ok) {
      return { ok: false, results, floorHeld };
    }
  }

  markPlanCompleted(plan.id);
  return { ok: true, results, floorHeld };
}
