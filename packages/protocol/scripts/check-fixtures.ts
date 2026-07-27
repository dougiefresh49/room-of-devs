/**
 * Validate every fixture against its schema. Exits non-zero on the first
 * mismatch — run after any schema change (pnpm run check-fixtures).
 *
 * Also runs the daemon hand-rolled validator extract (hand-validate.ts) over
 * every command fixture and FAILS on accept/reject disagreement with
 * parseCommand (audit Q-1 drift gate). After single-sourcing, the daemon
 * wraps parseCommand; the extract stays as the frozen oracle.
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
  COMMAND_TYPES,
  ServerEventSchema,
  SnapshotEventSchema,
  parseCommand,
} from "../src/index.js";
import { handValidatePanelMessage } from "./hand-validate.js";

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

/** Strip additive envelope fields the way the daemon does before validating. */
function stripEnvelope(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (record.requestId === undefined && record.source === undefined) return raw;
  const validRequestId = typeof record.requestId === "string" && record.requestId.length > 0;
  const validSource =
    record.source === "desktop" ||
    record.source === "mobile" ||
    record.source === "voice" ||
    record.source === "interpreter";
  if (
    (record.requestId !== undefined && !validRequestId) ||
    (record.source !== undefined && !validSource)
  ) {
    return raw;
  }
  const { requestId: _r, source: _s, ...body } = record;
  return body;
}

const snapshot = JSON.parse(readFileSync(join(fixturesDir, "panel-snapshot.json"), "utf-8"));
check("panel-snapshot.json (PanelSnapshot)", PanelSnapshotSchema, snapshot);
// The WS frame is the same snapshot with a type tag spread in.
check("panel-snapshot.json as WS frame (SnapshotEvent)", SnapshotEventSchema, {
  type: "snapshot",
  ...snapshot,
});

const commands = JSON.parse(readFileSync(join(fixturesDir, "commands.json"), "utf-8")) as unknown[];
commands.forEach((cmd, i) =>
  check(`commands.json[${i}] (${(cmd as any)?.type})`, CommandSchema, cmd),
);

// M-28: every known command type must appear in the positive fixture set.
const fixtureTypes = new Set(
  commands.map((cmd) => (cmd && typeof cmd === "object" ? (cmd as { type?: unknown }).type : null)),
);
for (const type of COMMAND_TYPES) {
  if (!fixtureTypes.has(type)) {
    failures++;
    console.error(`FAIL missing commands.json fixture for type: ${type}`);
  } else {
    console.log(`ok   coverage ${type}`);
  }
}

// Drift gate: protocol parseCommand vs daemon hand-rolled extract.
// Compare accept/reject only (output shape may differ on trims like set_setting.key).
commands.forEach((cmd, i) => {
  const body = stripEnvelope(cmd);
  const protocolOk = parseCommand(body) !== null;
  const daemonOk = handValidatePanelMessage(body) !== "bad_message";
  const label = `drift commands.json[${i}] (${(cmd as any)?.type})`;
  if (protocolOk === daemonOk) {
    console.log(`ok   ${label} both ${protocolOk ? "accept" : "reject"}`);
  } else {
    failures++;
    console.error(
      `FAIL ${label}: parseCommand=${protocolOk ? "accept" : "reject"} handValidate=${daemonOk ? "accept" : "reject"}`,
    );
  }
});

// Negative cases: these must FAIL validation (the daemon rejects them as
// bad_message; the schema mirrors that so clients learn at the boundary).
const invalidCommands = JSON.parse(
  readFileSync(join(fixturesDir, "invalid-commands.json"), "utf-8"),
) as unknown[];
invalidCommands.forEach((cmd, i) => {
  const body = stripEnvelope(cmd);
  const protocolOk = parseCommand(body) !== null;
  const daemonOk = handValidatePanelMessage(body) !== "bad_message";
  const type = (cmd as any)?.type;
  if (!protocolOk && !daemonOk) {
    console.log(`ok   invalid-commands.json[${i}] rejected by both (${type})`);
  } else {
    failures++;
    console.error(
      `FAIL invalid-commands.json[${i}] (${type}): parseCommand=${protocolOk ? "ACCEPT" : "reject"} handValidate=${daemonOk ? "ACCEPT" : "reject"}`,
    );
  }
});

const events = JSON.parse(readFileSync(join(fixturesDir, "events.json"), "utf-8")) as unknown[];
events.forEach((evt, i) =>
  check(`events.json[${i}] (${(evt as any)?.type})`, ServerEventSchema, evt),
);

if (failures > 0) {
  console.error(`\n${failures} fixture(s) failed validation`);
  process.exit(1);
}
console.log(`\nAll fixtures valid.`);
