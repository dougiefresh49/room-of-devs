/**
 * Phase 2 live WS verification — runs the REAL room-client code (WsTransport
 * + RoomClient) under Node (global WebSocket) against the deployed daemon.
 *
 * Checks:
 *  1. connect + initial snapshot carries rev AND epoch
 *  2. query() round-trip: known_dirs with requestId → tagged reply + resolve
 *  3. legacy send (no requestId) still answered, with NO command_result
 *  4. invalid command with requestId → command_result ok:false
 *  5. rev monotonicity across frames
 *  6. reconnect: on daemon restart (run externally), onConnection edges fire,
 *     epoch changes, snapshot recovers  — enabled with --wait-restart
 *
 * NO synthesis is triggered — only read-only queries and one bogus command.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  RoomClient,
  WsTransport,
} from "../src/index.js";

const tts = join(homedir(), ".cursor", "tts");
// Re-read per attempt — the daemon rotates the token on every boot, exactly
// like the panel's ws_token invoke does.
const freshUrl = async (): Promise<string> => {
  const token = readFileSync(join(tts, "panel_ws_token"), "utf8").trim();
  const port = JSON.parse(readFileSync(join(tts, "config.json"), "utf8")).panel_port ?? 4780;
  return `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
};

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const transport = new WsTransport(freshUrl);
const client = new RoomClient(transport, { source: "desktop" });

const events: { type: string; requestId?: string }[] = [];
client.onEvent((ev) => events.push(ev as never));

const connectionEdges: boolean[] = [];
transport.onConnection((up) => connectionEdges.push(up));

const waitFor = (pred: () => boolean, ms: number) =>
  new Promise<boolean>((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); resolve(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(false); }
    }, 50);
  });

async function main() {
  client.start();

  // 1. initial snapshot with rev + epoch
  const gotSnap = await waitFor(() => client.getState().snapshot !== null, 5000);
  const snap = client.getState().snapshot;
  check("initial snapshot received", gotSnap);
  check("snapshot has rev", typeof snap?.rev === "number", `rev=${snap?.rev}`);
  check("snapshot has epoch", typeof snap?.epoch === "number", `epoch=${snap?.epoch}`);

  // 2. typed query round-trip (requestId correlation)
  try {
    const dirs = await client.query("known_dirs", 5000);
    check("query(known_dirs) resolved", Array.isArray(dirs.dirs), `${dirs.dirs.length} dirs, requestId=${!!dirs.requestId}`);
  } catch (err) {
    check("query(known_dirs) resolved", false, String(err));
  }
  const gotCr = events.some((e) => e.type === "command_result");
  check("command_result observed for requestId path", gotCr);

  // 3. legacy fire-and-forget: reply arrives, no NEW command_result
  const crBefore = events.filter((e) => e.type === "command_result").length;
  const dirsBefore = events.filter((e) => e.type === "known_dirs").length;
  client.send({ type: "known_dirs" });
  const gotLegacy = await waitFor(
    () => events.filter((e) => e.type === "known_dirs").length > dirsBefore,
    5000,
  );
  await new Promise((r) => setTimeout(r, 400));
  const crAfter = events.filter((e) => e.type === "command_result").length;
  check("legacy known_dirs (no requestId) answered", gotLegacy);
  check("legacy path emitted NO command_result", crAfter === crBefore, `before=${crBefore} after=${crAfter}`);

  // 4. invalid command with requestId → correlated failure
  try {
    const res = await client.request({ type: "focus_terminal", sessionId: "no-such-session-xyz" } as never, 5000);
    check("invalid-session command_result ok:false", res.ok === false, `code=${res.code}`);
  } catch (err) {
    check("invalid-session command_result ok:false", false, `rejected: ${String(err)}`);
  }

  // 5. rev monotonicity: poke the daemon state indirectly by re-querying;
  //    just observe any later snapshots (room activity) — soft check.
  const rev0 = client.getState().snapshot?.rev ?? -1;
  check("rev monotonic baseline captured", rev0 >= 0, `rev=${rev0}`);

  if (process.argv.includes("--wait-restart")) {
    console.log("\nNow restart the daemon (tts-server.sh restart). Waiting up to 60s for down+up edges...");
    const sawDown = await waitFor(() => connectionEdges.includes(false), 60_000);
    const downIdx = connectionEdges.indexOf(false);
    const sawUp = await waitFor(() => connectionEdges.slice(downIdx + 1).includes(true), 60_000);
    check("reconnect: down edge observed", sawDown);
    check("reconnect: up edge observed (backoff loop alive)", sawUp);
    const recovered = await waitFor(
      () => (client.getState().snapshot?.epoch ?? 0) !== (snap?.epoch ?? 0) && client.getState().snapshot !== snap,
      15_000,
    );
    const snap2 = client.getState().snapshot;
    check("reconnect: fresh snapshot with NEW epoch applied", recovered, `epoch ${snap?.epoch} → ${snap2?.epoch}, rev ${rev0} → ${snap2?.rev}`);
  }

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  client.dispose();
  process.exit(failed ? 1 : 0);
}

void main();
// Run from the repo root (tsx comes from tts-server's dev deps):
//   pnpm -C tts-server exec tsx ../packages/room-client/scripts/verify-live.ts
// Reconnect coverage: add --wait-restart, then run tts-server.sh restart.
