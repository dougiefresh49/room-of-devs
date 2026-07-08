/**
 * Scratch integration test for panel-ws — uses TTS_DIR_OVERRIDE, no live APIs.
 * Run: pnpm exec tsx test-panel-ws.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "net";

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "panel-ws-test-"));
  const port = await findFreePort();

  process.env.TTS_DIR_OVERRIDE = tmp;
  mkdirSync(join(tmp, "state"), { recursive: true });
  mkdirSync(join(tmp, "queue"), { recursive: true });
  mkdirSync(join(tmp, "played"), { recursive: true });
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  mkdirSync(join(tmp, "tts-server"), { recursive: true });

  writeFileSync(
    join(tmp, "config.json"),
    JSON.stringify({ panel_port: port, elevenlabs_voice_id: "" }, null, 2)
  );

  const sessionId = "abc123def456ghi789jkl";
  writeFileSync(
    join(tmp, "state", `${sessionId}.json`),
    JSON.stringify(
      {
        sessionId,
        name: "Test Agent",
        state: "hand_raised",
        raisedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  const { validatePanelMessage, isAllowedOrigin } = await import("./src/panel-ws.js");
  const { buildSnapshot } = await import("./src/state-watch.js");
  const { default: WebSocket } = await import("ws");

  // Direct validation checks
  const bad = validatePanelMessage({ type: "nope" });
  if (bad !== "bad_message") throw new Error(`expected bad_message, got ${JSON.stringify(bad)}`);
  if (!isAllowedOrigin(undefined)) throw new Error("missing origin should be allowed");
  if (isAllowedOrigin("https://evil.example")) throw new Error("evil origin should be rejected");
  if (!isAllowedOrigin("http://localhost:1420")) throw new Error("localhost origin should be allowed");

  const snap = buildSnapshot();
  if (snap.length !== 1 || snap[0].sessionId !== sessionId) {
    throw new Error(`snapshot mismatch: ${JSON.stringify(snap)}`);
  }

  const { startPanelWs, stopPanelWs } = await import("./src/panel-ws.js");
  startPanelWs();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("listen timeout")), 3000);
    const check = setInterval(() => {
      try {
        readFileSync(join(tmp, "panel_ws_token"), "utf-8");
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      } catch {
        /* not ready */
      }
    }, 20);
  });

  const token = readFileSync(join(tmp, "panel_ws_token"), "utf-8").trim();
  const url = `ws://127.0.0.1:${port}?token=${token}`;

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ws connect timeout"));
    }, 3000);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "snapshot") {
        if (!Array.isArray(msg.agents) || msg.agents[0]?.name !== "Test Agent") {
          clearTimeout(timer);
          ws.close();
          reject(new Error(`bad snapshot: ${data.toString()}`));
          return;
        }
        ws.send(JSON.stringify({ type: "bogus", extra: true }));
      } else if (msg.type === "error" && msg.code === "bad_message") {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  stopPanelWs();
  rmSync(tmp, { recursive: true, force: true });

  console.log("panel-ws test OK:");
  console.log("  - validatePanelMessage rejects unknown type");
  console.log("  - isAllowedOrigin allows localhost / absent, rejects evil");
  console.log("  - buildSnapshot returns agent from scratch state/");
  console.log("  - WebSocket connect receives snapshot + bad_message on invalid msg");
}

main().catch((err) => {
  console.error("panel-ws test FAILED:", err.message ?? err);
  process.exit(1);
});
