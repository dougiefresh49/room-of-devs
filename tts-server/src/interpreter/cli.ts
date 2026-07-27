/**
 * One-shot interpreter CLI — free test harness (mirrors index.ts once pattern).
 *
 *   tsx src/interpreter/cli.ts route [--target <sid>] [--dry-run] "<text>"
 */
import { pathToFileURL } from "url";
import { loadEnv } from "../config.js";
import { dryResolve, handleIntent } from "./coordinator.js";
import { analyzePlan } from "./plan.js";
import type { Action } from "./rule-router.js";

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  if (args[0] !== "route") {
    console.error(
      'Usage: tsx src/interpreter/cli.ts route [--target <sessionId>] [--dry-run] "<transcript>"',
    );
    process.exit(1);
  }

  let target: string | undefined;
  let dryRun = false;
  const rest: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1]) {
      target = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else {
      rest.push(args[i]);
    }
  }

  const transcript = rest.join(" ").trim();
  if (!transcript) {
    console.error(
      'Usage: tsx src/interpreter/cli.ts route [--target <sessionId>] [--dry-run] "<transcript>"',
    );
    process.exit(1);
  }

  if (dryRun) {
    const resolved = await dryResolve(transcript, target ?? null);
    console.log(JSON.stringify(resolved, null, 2));
    process.exit(0);
  }

  const intentId = `cli-${Date.now()}-${process.pid}`;
  await handleIntent(
    {
      transcript,
      boundTarget: target ?? null,
      source: "voice",
      capturedAt: Date.now(),
      duckToken: null,
    },
    intentId,
  );
  process.exit(0);
}

/** Allow `tsx -e` style plan analysis without a live LLM. */
export function dryPlan(steps: Action[]): unknown {
  return { type: "plan", ...analyzePlan(steps) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
