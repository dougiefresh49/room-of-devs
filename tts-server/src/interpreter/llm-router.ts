/**
 * LlmRouter — flash-lite function-calling over the closed voice tool vocabulary.
 * Own client (NOT processWithGemini). No-key / timeout → null (caller falls back).
 */
import {
  GoogleGenAI,
  Type,
  FunctionCallingConfigMode,
  type FunctionDeclaration,
} from "@google/genai";
import { loadConfig } from "../config.js";
import { log } from "../logger.js";
import { type Action, type RouterContext, listCandidateNames } from "./rule-router.js";

export type RouterResult =
  | { kind: "action"; action: Action }
  | { kind: "plan"; steps: Action[] }
  | { kind: "none"; reason: string };

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  if (client) return client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  client = new GoogleGenAI({ apiKey: key });
  return client;
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "grant",
    description: "Grant the floor to a session, optionally by spoken name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description: "Spoken session/persona name, if any.",
        },
      },
    },
  },
  {
    name: "pause_resume",
    description: "Pause or resume playback (toggle).",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "stop",
    description: "Stop current playback.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "cancel_inject",
    description: "Cancel a pending armed inject.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "hold_room",
    description: "Hold the room (silence grants) for optional minutes.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        minutes: { type: Type.NUMBER, description: "Hold duration in minutes." },
      },
    },
  },
  {
    name: "release_room",
    description: "Release a room hold.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "replay",
    description: "Replay the last spoken message.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        slower: {
          type: Type.BOOLEAN,
          description: "If true, replay at reduced speed.",
        },
      },
    },
  },
  {
    name: "status",
    description: "Speak a short room status summary.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "mood",
    description: "Set a mood preset: focus, arcade, quiet, or normal.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        preset: { type: Type.STRING, description: "Mood preset name." },
      },
      required: ["preset"],
    },
  },
  {
    name: "mute",
    description: "Mute a session by spoken name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING, description: "Spoken name." },
      },
      required: ["target"],
    },
  },
  {
    name: "unmute",
    description: "Unmute a session by spoken name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING, description: "Spoken name." },
      },
      required: ["target"],
    },
  },
  {
    name: "clear_queue",
    description: "Clear a session's TTS queue (queue hygiene only — NOT Claude /clear).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING, description: "Spoken name." },
      },
      required: ["target"],
    },
  },
  {
    name: "inject_reply",
    description:
      "Send a text reply into a team session. Omit target to use the bound/default session.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING, description: "Spoken persona name." },
        message: { type: Type.STRING, description: "Message to inject." },
      },
      required: ["message"],
    },
  },
  {
    name: "slash_command",
    description:
      "Inject a Claude slash command (e.g. name 'clear' for /clear). " +
      "'clear the session / clear context / fresh start' means slash_command clear — " +
      "NOT clear_queue.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "Slash command name without the leading slash.",
        },
        target: { type: Type.STRING, description: "Spoken persona name." },
      },
      required: ["name"],
    },
  },
  {
    name: "plan",
    description:
      "Ordered multi-step compound. Decompose ONLY on explicit conjunction/" +
      "sequencing ('and then', 'after that'); never invent steps.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        steps: {
          type: Type.ARRAY,
          description: "Ordered tool calls as objects with name + args.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              args: { type: Type.OBJECT },
            },
            required: ["name"],
          },
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "none",
    description: "Not a room command (free-form speech or unclear). Prefer this over guessing.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: "Brief why." },
      },
      required: ["reason"],
    },
  },
];

function buildSystemPrompt(ctx: RouterContext): string {
  const names = listCandidateNames();
  const nameList = names.length ? names.join(", ") : "(no live candidates)";
  const bound = ctx.boundTarget
    ? `A session is bound as the default inject target (do not emit sessionIds).`
    : `No bound session — inject_reply/slash_command need an explicit spoken target unless only one persona is in the room.`;

  return `You are the Room of Devs voice command router. Map the owner's utterance to exactly ONE tool call.

Live candidate names (spoken forms): ${nameList}
${bound}

Hard rules:
- Exactly one tool call. Prefer none over guessing.
- Target arguments are spoken names only ("donnie", "raph") — never sessionIds.
- "clear the queue / skip / never mind <name>" → clear_queue.
- "clear the session / clear context / fresh start / /clear" → slash_command name=clear.
- Decompose into plan ONLY on explicit sequencing ("and then", "after that", "then").
- Free-form speech that should go to a coding agent → none (or inject_reply if clearly "tell X …").`;
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function numArg(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function boolArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function toolToAction(
  name: string,
  args: Record<string, unknown>,
): Action | { plan: Action[] } | { none: string } | null {
  switch (name) {
    case "grant":
      return { kind: "grant", sessionId: strArg(args, "target") };
    case "pause_resume":
      return { kind: "pause" };
    case "stop":
      return { kind: "stop" };
    case "cancel_inject":
      return { kind: "cancel_inject" };
    case "hold_room":
      return { kind: "hold_room", minutes: numArg(args, "minutes") };
    case "release_room":
      return { kind: "release_room" };
    case "replay":
      return {
        kind: "replay",
        speed: boolArg(args, "slower") ? 0.85 : undefined,
      };
    case "status":
      return { kind: "status" };
    case "mood": {
      const preset = strArg(args, "preset");
      if (!preset) return null;
      return { kind: "mood", preset };
    }
    case "mute": {
      const target = strArg(args, "target");
      if (!target) return null;
      return { kind: "mute", sessionId: target };
    }
    case "unmute": {
      const target = strArg(args, "target");
      if (!target) return null;
      return { kind: "unmute", sessionId: target };
    }
    case "clear_queue": {
      const target = strArg(args, "target");
      if (!target) return null;
      return { kind: "clear", sessionId: target };
    }
    case "inject_reply": {
      const message = strArg(args, "message");
      if (!message) return null;
      return {
        kind: "inject",
        target: strArg(args, "target") ?? "",
        message,
      };
    }
    case "slash_command": {
      const cmd = strArg(args, "name");
      if (!cmd) return null;
      return {
        kind: "slash_command",
        command: cmd,
        target: strArg(args, "target"),
      };
    }
    case "plan": {
      const rawSteps = args.steps;
      if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;
      const steps: Action[] = [];
      for (const raw of rawSteps) {
        if (!raw || typeof raw !== "object") return null;
        const step = raw as Record<string, unknown>;
        const stepName = typeof step.name === "string" ? step.name : "";
        if (!stepName || stepName === "plan" || stepName === "none") return null;
        const stepArgs =
          step.args && typeof step.args === "object" && !Array.isArray(step.args)
            ? (step.args as Record<string, unknown>)
            : {};
        const mapped = toolToAction(stepName, stepArgs);
        if (!mapped || "plan" in mapped || "none" in mapped) return null;
        steps.push(mapped);
      }
      return { plan: steps };
    }
    case "none":
      return { none: strArg(args, "reason") ?? "not a command" };
    default:
      return null;
  }
}

function toRouterResult(name: string, args: Record<string, unknown>): RouterResult | null {
  const mapped = toolToAction(name, args);
  if (!mapped) return null;
  if ("plan" in mapped) return { kind: "plan", steps: mapped.plan };
  if ("none" in mapped) return { kind: "none", reason: mapped.none };
  return { kind: "action", action: mapped };
}

export async function routeWithLlm(
  transcript: string,
  ctx: RouterContext = {},
): Promise<RouterResult | null> {
  const ai = getClient();
  if (!ai) {
    log("interpreter", "LlmRouter: no GEMINI_API_KEY — skip");
    return null;
  }

  const config = loadConfig();
  const model = config.interpreter_model;
  const timeoutMs = config.interpreter_timeout_ms;
  const started = Date.now();

  try {
    const response = await ai.models.generateContent({
      model,
      contents: transcript,
      config: {
        systemInstruction: buildSystemPrompt(ctx),
        temperature: 0,
        maxOutputTokens: 512,
        abortSignal: AbortSignal.timeout(timeoutMs),
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
        },
      },
    });

    const calls = response.functionCalls;
    const call = calls?.[0];
    const duration = Date.now() - started;
    if (!call?.name) {
      log("interpreter", `LlmRouter ${duration}ms tool=none (empty)`);
      return null;
    }
    const args = (call.args ?? {}) as Record<string, unknown>;
    const result = toRouterResult(call.name, args);
    log("interpreter", `LlmRouter ${duration}ms tool=${call.name}${result ? "" : " (unmapped)"}`);
    return result;
  } catch (err: any) {
    const duration = Date.now() - started;
    const msg = err?.message ?? String(err);
    log("interpreter", `LlmRouter ${duration}ms error: ${msg}`);
    return null;
  }
}
