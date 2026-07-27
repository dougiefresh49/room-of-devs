/**
 * TurnCoordinator — rules → LLM → validate → execute → reply → un-duck.
 */
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { loadSessionVoices } from "../config.js";
import { log } from "../logger.js";
import { dispatch, runScriptSync } from "../services/commands.js";
import { acquireLock, releaseLock } from "../playback-locks.js";
import { playMp3Buffer } from "../audio.js";
import { getPhrasesForVoice } from "../phrases.js";
import {
  type Action,
  type RouterContext,
  buildFloorCandidates,
  composeStatus,
  matchIntent,
  normalizeTranscript,
  resolveByName,
  resolveDefaultInjectionTarget,
  resolveInjectionTarget,
  speakableName,
} from "./rule-router.js";
import { routeWithLlm, type RouterResult } from "./llm-router.js";
import {
  type CommandPlan,
  type StepResult,
  analyzePlan,
  isFloorHoldingAction,
  markPlanCompleted,
  runPlan,
  runScriptAsync,
  wasPlanCompleted,
} from "./plan.js";

export interface IntentFile {
  transcript: string;
  boundTarget: string | null;
  source: string;
  capturedAt: number;
  duckToken: string | null;
}

export type ResolvedRoute =
  | { type: "action"; action: Action }
  | { type: "plan"; steps: Action[] }
  | { type: "clarify"; message: string }
  | { type: "inject_fallback"; target: string; message: string };

interface PendingConfirmation {
  planId: string;
  remaining: Action[];
  confirmLabel: string;
  expiresAt: number;
  duckToken: string | null;
  boundTarget: string | null;
}

let pendingConfirm: PendingConfirmation | null = null;

function speak(text: string): void {
  spawnSync("say", [text], { stdio: "ignore" });
}

function unduck(duckToken: string | null, floorHeld: boolean): void {
  if (!duckToken || floorHeld) return;
  // pause.sh toggles — we ducked on PTT start, so this resumes.
  runScriptSync("pause.sh", []);
}

async function playPlanAck(boundTarget: string | null): Promise<void> {
  const voices = loadSessionVoices();
  let voiceId: string | undefined;
  if (boundTarget && voices[boundTarget]) voiceId = voices[boundTarget];
  if (!voiceId) voiceId = Object.values(voices)[0];
  if (!voiceId) return;

  const files = getPhrasesForVoice(voiceId, "ack");
  if (files.length === 0) return;
  if (!acquireLock()) {
    // Floor busy — exit-2 semantics, never wait.
    log("interpreter", "plan ack skipped — floor busy");
    return;
  }
  try {
    const pick = files[Math.floor(Math.random() * files.length)];
    const buf = readFileSync(pick);
    await playMp3Buffer(buf, "meta", {
      source: "interpreter",
      kind: "ack",
      timestamp: new Date().toISOString(),
    });
  } finally {
    releaseLock();
  }
}

type Validated = { ok: true; action: Action } | { ok: false; clarify: string };

function validateAction(action: Action, ctx: RouterContext): Validated {
  switch (action.kind) {
    case "grant": {
      if (!action.sessionId) return { ok: true, action };
      const res = resolveByName(action.sessionId, buildFloorCandidates());
      if ("ok" in res && res.ok) {
        return { ok: true, action: { kind: "grant", sessionId: res.ok } };
      }
      if ("ambiguous" in res) {
        return { ok: false, clarify: `Which one? ${res.ambiguous.join(", ")}.` };
      }
      return { ok: false, clarify: "Couldn't find that session." };
    }
    case "mute":
    case "unmute":
    case "clear": {
      const res = resolveByName(action.sessionId, buildFloorCandidates());
      if ("ok" in res && res.ok) {
        return { ok: true, action: { ...action, sessionId: res.ok } };
      }
      if ("ambiguous" in res) {
        return { ok: false, clarify: `Which one? ${res.ambiguous.join(", ")}.` };
      }
      return { ok: false, clarify: "Couldn't find that session." };
    }
    case "inject": {
      if (!action.target) {
        if (ctx.boundTarget) {
          return {
            ok: true,
            action: {
              kind: "inject",
              target: ctx.boundTarget,
              message: action.message,
            },
          };
        }
        const def = resolveDefaultInjectionTarget();
        if ("ok" in def && def.ok) {
          return {
            ok: true,
            action: { kind: "inject", target: def.ok, message: action.message },
          };
        }
        if ("ambiguous" in def) {
          return {
            ok: false,
            clarify: `Which one? ${def.ambiguous.join(", ")}.`,
          };
        }
        return {
          ok: false,
          clarify: "Can't reach them — not running in the team room.",
        };
      }
      const res = resolveInjectionTarget(action.target);
      if ("ok" in res && res.ok) {
        return {
          ok: true,
          action: { kind: "inject", target: res.ok, message: action.message },
        };
      }
      if ("ambiguous" in res) {
        return { ok: false, clarify: `Which one? ${res.ambiguous.join(", ")}.` };
      }
      return {
        ok: false,
        clarify: `Can't reach ${action.target} — not running in the team room.`,
      };
    }
    case "slash_command": {
      const res = action.target
        ? resolveInjectionTarget(action.target)
        : ctx.boundTarget
          ? ({ ok: ctx.boundTarget } as const)
          : resolveDefaultInjectionTarget();
      if ("ok" in res && res.ok) {
        return {
          ok: true,
          action: {
            kind: "slash_command",
            command: action.command,
            target: res.ok,
          },
        };
      }
      if ("ambiguous" in res) {
        return { ok: false, clarify: `Which one? ${res.ambiguous.join(", ")}.` };
      }
      return {
        ok: false,
        clarify: `Can't reach ${action.target ?? "them"} — not running in the team room.`,
      };
    }
    default:
      return { ok: true, action };
  }
}

async function executeStep(
  action: Action,
  opts: { inPlan: boolean },
): Promise<{ result: StepResult; floorHeld: boolean }> {
  const floorHeld = isFloorHoldingAction(action);

  switch (action.kind) {
    case "grant": {
      const args = action.sessionId ? [action.sessionId] : [];
      // Prefer shared command service when we have a concrete session.
      if (action.sessionId) {
        dispatch({ type: "grant", sessionId: action.sessionId });
        return { result: { ok: true }, floorHeld };
      }
      const r = await runScriptAsync("grant_floor.sh", args);
      return { result: r, floorHeld };
    }
    case "pause":
      dispatch({ type: "pause" });
      return { result: { ok: true }, floorHeld };
    case "stop":
      dispatch({ type: "stop" });
      return { result: { ok: true }, floorHeld };
    case "replay": {
      if (action.speed != null && action.speed < 1) {
        dispatch({ type: "replay_slower" });
      } else {
        dispatch({ type: "replay" });
      }
      return { result: { ok: true }, floorHeld };
    }
    case "status": {
      speak(composeStatus());
      return { result: { ok: true }, floorHeld: false };
    }
    case "mute":
    case "unmute": {
      const r = await runScriptAsync("set_session_mute.sh", [action.sessionId, action.kind]);
      return { result: r, floorHeld: false };
    }
    case "clear": {
      const r = await runScriptAsync("clear_session_queue.sh", [action.sessionId]);
      return { result: r, floorHeld: false };
    }
    case "inject": {
      const args = opts.inPlan
        ? ["--now", action.target, action.message]
        : [action.target, action.message];
      const r = await runScriptAsync("inject_prompt.sh", args);
      if (!r.ok && r.message?.includes("exited 3")) {
        return {
          result: {
            ok: false,
            code: "not_in_team",
            message: `Can't reach ${speakableName(action.target)} — not running in the team room.`,
          },
          floorHeld: false,
        };
      }
      return { result: r, floorHeld: false };
    }
    case "slash_command": {
      const message = `/${action.command.replace(/^\//, "")}`;
      const target = action.target!;
      const args = opts.inPlan ? ["--now", target, message] : [target, message];
      const r = await runScriptAsync("inject_prompt.sh", args);
      return { result: r, floorHeld: false };
    }
    case "mood": {
      const r = await runScriptAsync("set_mood.sh", [action.preset]);
      return { result: r, floorHeld };
    }
    case "hold_room": {
      const args = action.minutes != null ? [String(action.minutes)] : [];
      // Toggle-aware via commands when no minutes specified.
      if (action.minutes == null) {
        dispatch({ type: "hold_room" });
        return { result: { ok: true }, floorHeld };
      }
      const r = await runScriptAsync("hold_room.sh", args);
      return { result: r, floorHeld };
    }
    case "release_room": {
      const r = await runScriptAsync("hold_room.sh", ["off"]);
      return { result: r, floorHeld };
    }
    case "cancel_inject": {
      const r = await runScriptAsync("cancel_inject.sh", []);
      return { result: r, floorHeld: false };
    }
  }
}

function isConfirmTranscript(text: string): boolean {
  return /^(confirm|yes|yeah|yep|do it|go ahead)$/.test(text);
}

function isCancelTranscript(text: string): boolean {
  return /^(cancel|no|nope|never ?mind|stop)$/.test(text);
}

/**
 * Resolve transcript → action/plan/clarify/fallback without executing.
 * Used by CLI --dry-run and handleIntent.
 */
export async function resolveRoute(transcript: string, ctx: RouterContext): Promise<ResolvedRoute> {
  const rule = matchIntent(transcript, ctx);
  if (rule) return { type: "action", action: rule };

  const llm = await routeWithLlm(transcript, ctx);
  if (llm) {
    const mapped = llmResultToRoute(llm, ctx);
    if (mapped) return mapped;
  }

  if (ctx.boundTarget) {
    return {
      type: "inject_fallback",
      target: ctx.boundTarget,
      message: transcript.trim(),
    };
  }
  return { type: "clarify", message: "Didn't catch that" };
}

function llmResultToRoute(llm: RouterResult, ctx: RouterContext): ResolvedRoute | null {
  if (llm.kind === "none") {
    if (ctx.boundTarget) {
      return null; // caller falls through to inject_fallback with original transcript
    }
    return { type: "clarify", message: "Didn't catch that" };
  }
  if (llm.kind === "plan") {
    if (llm.steps.length === 0) return null;
    return { type: "plan", steps: llm.steps };
  }
  return { type: "action", action: llm.action };
}

/**
 * Dry-run preview: resolve without executing. Returns the grammar/LLM action
 * as heard (names unresolved) so fixtures don't need a live team_map.
 */
export async function dryResolve(
  transcript: string,
  boundTarget?: string | null,
): Promise<unknown> {
  const ctx: RouterContext = { boundTarget: boundTarget ?? null };
  const resolved = await resolveRoute(transcript, ctx);

  if (resolved.type === "clarify") {
    return { type: "clarify", message: resolved.message };
  }
  if (resolved.type === "inject_fallback") {
    return {
      type: "inject_fallback",
      target: resolved.target,
      message: resolved.message,
    };
  }
  if (resolved.type === "action") {
    return { type: "action", action: resolved.action };
  }
  return {
    type: "plan",
    ...analyzePlan(resolved.steps),
  };
}

export async function handleIntent(intent: IntentFile, intentId: string): Promise<void> {
  if (wasPlanCompleted(intentId)) {
    log("interpreter", `intent ${intentId}: idempotent skip`);
    unduck(intent.duckToken, false);
    return;
  }

  const ctx: RouterContext = { boundTarget: intent.boundTarget };
  const text = normalizeTranscript(intent.transcript);

  // Pending /clear (etc.) confirmation gate
  if (pendingConfirm) {
    if (Date.now() > pendingConfirm.expiresAt) {
      log("interpreter", "pending confirmation expired");
      pendingConfirm = null;
    } else if (isConfirmTranscript(text)) {
      const pending = pendingConfirm;
      pendingConfirm = null;
      let floorHeld = false;
      for (const action of pending.remaining) {
        const v = validateAction(action, {
          boundTarget: pending.boundTarget,
        });
        if (!v.ok) {
          speak(v.clarify);
          unduck(pending.duckToken, floorHeld);
          return;
        }
        const { result, floorHeld: held } = await executeStep(v.action, {
          inPlan: true,
        });
        if (held) floorHeld = true;
        if (!result.ok) {
          speak(
            result.message ??
              `Failed on ${speakableName(v.action.kind === "slash_command" ? (v.action.target ?? "") : "")}`,
          );
          unduck(pending.duckToken, floorHeld);
          return;
        }
      }
      markPlanCompleted(pending.planId);
      unduck(pending.duckToken, floorHeld);
      return;
    } else if (isCancelTranscript(text)) {
      pendingConfirm = null;
      speak("Cancelled");
      unduck(intent.duckToken, false);
      return;
    } else {
      // A different command while armed — cancel the pending confirm and continue.
      pendingConfirm = null;
      speak("Cancelled the clear");
    }
  }

  const resolved = await resolveRoute(intent.transcript, ctx);
  let floorHeld = false;

  try {
    if (resolved.type === "clarify") {
      speak(resolved.message);
      return;
    }

    if (resolved.type === "inject_fallback") {
      const { result } = await executeStep(
        {
          kind: "inject",
          target: resolved.target,
          message: resolved.message,
        },
        { inPlan: false },
      );
      if (!result.ok) {
        speak(
          result.message ??
            `Can't reach ${speakableName(resolved.target)} — not running in the team room.`,
        );
      }
      return;
    }

    if (resolved.type === "action") {
      const v = validateAction(resolved.action, ctx);
      if (!v.ok) {
        speak(v.clarify);
        return;
      }
      // Single destructive slash → confirm gate even outside a plan.
      if (
        v.action.kind === "slash_command" &&
        ["clear", "kill", "exit"].includes(v.action.command.toLowerCase().replace(/^\//, ""))
      ) {
        const cmd = v.action.command.toLowerCase().replace(/^\//, "");
        pendingConfirm = {
          planId: intentId,
          remaining: [v.action],
          confirmLabel: speakableName(v.action.target ?? "that session"),
          expiresAt: Date.now() + 10_000,
          duckToken: intent.duckToken,
          boundTarget: intent.boundTarget,
        };
        const verb = cmd === "kill" ? "Killing" : cmd === "exit" ? "Exiting" : "Clearing";
        speak(`${verb} ${pendingConfirm.confirmLabel}'s session — say confirm`);
        // Keep ducked until confirm resolves (don't unduck in finally).
        floorHeld = true;
        return;
      }
      const { result, floorHeld: held } = await executeStep(v.action, {
        inPlan: false,
      });
      floorHeld = held;
      if (!result.ok) {
        speak(result.message ?? "That didn't work");
      }
      // Silent success for single actions.
      if (result.ok) markPlanCompleted(intentId);
      return;
    }

    // Plan
    const validated: Action[] = [];
    for (const step of resolved.steps) {
      const v = validateAction(step, ctx);
      if (!v.ok) {
        speak(v.clarify);
        return;
      }
      validated.push(v.action);
    }

    await playPlanAck(intent.boundTarget);

    const plan: CommandPlan = { id: intentId, steps: validated };
    const planResult = await runPlan(plan, executeStep);
    floorHeld = planResult.floorHeld;

    if (planResult.awaitingConfirmation && planResult.remaining) {
      const first = planResult.remaining[0];
      const cmd =
        first?.kind === "slash_command" ? first.command.toLowerCase().replace(/^\//, "") : "clear";
      pendingConfirm = {
        planId: intentId,
        remaining: planResult.remaining,
        confirmLabel: planResult.confirmLabel ?? "that session",
        expiresAt: Date.now() + 10_000,
        duckToken: intent.duckToken,
        boundTarget: intent.boundTarget,
      };
      const verb = cmd === "kill" ? "Killing" : cmd === "exit" ? "Exiting" : "Clearing";
      speak(`${verb} ${pendingConfirm.confirmLabel}'s session — say confirm`);
      floorHeld = true; // hold duck through confirmation window
      return;
    }

    if (!planResult.ok) {
      const last = planResult.results[planResult.results.length - 1];
      speak(last?.message ?? "That didn't work");
      return;
    }
  } finally {
    unduck(intent.duckToken, floorHeld);
  }
}

/** Test helper — expose plan analysis without LLM. */
export { analyzePlan };
