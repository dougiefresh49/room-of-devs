/**
 * Validate every fixture against its schema. Exits non-zero on the first
 * mismatch — run after any schema change (pnpm run check-fixtures).
 *
 * Fixtures are sanitized captures from the real daemon; if a legitimate
 * server change breaks one, re-capture it, don't hand-bend the schema.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as v from "valibot";
import {
  PanelSnapshotSchema,
  CommandSchema,
  ServerEventSchema,
  SnapshotEventSchema,
} from "../src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
let failures = 0;

function check(label: string, schema: v.GenericSchema<any, any>, data: unknown): void {
  const result = v.safeParse(schema, data);
  if (result.success) {
    console.log(`ok   ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL ${label}`);
  for (const issue of result.issues.slice(0, 5)) {
    console.error(`     ${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`);
  }
}

const snapshot = JSON.parse(
  readFileSync(join(fixturesDir, "panel-snapshot.json"), "utf-8")
);
check("panel-snapshot.json (PanelSnapshot)", PanelSnapshotSchema, snapshot);
// The WS frame is the same snapshot with a type tag spread in.
check(
  "panel-snapshot.json as WS frame (SnapshotEvent)",
  SnapshotEventSchema,
  { type: "snapshot", ...snapshot }
);

const commands = JSON.parse(
  readFileSync(join(fixturesDir, "commands.json"), "utf-8")
) as unknown[];
commands.forEach((cmd, i) =>
  check(`commands.json[${i}] (${(cmd as any)?.type})`, CommandSchema, cmd)
);

const events = JSON.parse(
  readFileSync(join(fixturesDir, "events.json"), "utf-8")
) as unknown[];
events.forEach((evt, i) =>
  check(`events.json[${i}] (${(evt as any)?.type})`, ServerEventSchema, evt)
);

if (failures > 0) {
  console.error(`\n${failures} fixture(s) failed validation`);
  process.exit(1);
}
console.log(`\nAll fixtures valid.`);
