/**
 * Scratch WS test for button config CRUD — uses TTS_DIR_OVERRIDE, no device/daemon.
 * Run: pnpm exec tsx test-panel-ws-buttons.ts
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { createServer } from "net";
import { fileURLToPath } from "url";

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
  const tmp = mkdtempSync(join(tmpdir(), "panel-ws-buttons-"));
  const port = await findFreePort();

  process.env.TTS_DIR_OVERRIDE = tmp;
  mkdirSync(join(tmp, "state"), { recursive: true });
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  mkdirSync(join(tmp, "tts-server"), { recursive: true });

  writeFileSync(
    join(tmp, "config.json"),
    JSON.stringify({ panel_port: port, arcade_enabled: false }, null, 2),
  );
  writeFileSync(
    join(tmp, "arcade_buttons.json"),
    JSON.stringify({ device_hint: "test-joystick", buttons: {} }, null, 2),
  );

  // characters.json is the REAL (gitignored, hand-authored) character
  // catalog — stomping it with the test fixture and not restoring it broke
  // every persona in production on 2026-07-22. Save it, restore on exit.
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "src");
  const charactersPath = join(srcDir, "characters.json");
  const realCharacters = existsSync(charactersPath) ? readFileSync(charactersPath, "utf-8") : null;
  const restoreCharacters = () => {
    if (realCharacters !== null) writeFileSync(charactersPath, realCharacters);
    else rmSync(charactersPath, { force: true });
  };
  process.on("exit", restoreCharacters);
  writeFileSync(
    charactersPath,
    JSON.stringify(
      {
        v1: { name: "Leonardo" },
        v2: { name: "Donatello" },
      },
      null,
      2,
    ),
  );

  const { captureNextPress, isCaptureReady } = await import("./src/hid.js");
  if (isCaptureReady()) throw new Error("isCaptureReady should be false without device");
  const noCap = await captureNextPress(50);
  if (noCap !== null) throw new Error("captureNextPress should resolve null without device");

  const { startPanelWs, stopPanelWs } = await import("./src/panel-ws.js");
  const { default: WebSocket } = await import("ws");

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
      reject(new Error("ws test timeout"));
    }, 5000);
    let sawSnapshot = false;
    let phase:
      | "init"
      | "set"
      | "capture"
      | "clear-character"
      | "set-action"
      | "clear-action"
      | "set-empty-clear"
      | "empty-clear"
      | "bad-name-null"
      | "bad-both-set"
      | "bad-empty-patch"
      | "remove" = "init";

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === "snapshot") {
        sawSnapshot = true;
        ws.send(JSON.stringify({ type: "get_buttons" }));
        return;
      }

      if (
        phase === "init" &&
        msg.type === "buttons" &&
        sawSnapshot &&
        Object.keys(msg.buttons ?? {}).length === 0
      ) {
        phase = "set";
        ws.send(
          JSON.stringify({
            type: "set_button",
            idx: 4,
            patch: {
              name: "blue",
              character: "Leonardo",
              color: "blue",
              notes: "test note",
            },
          }),
        );
        return;
      }

      if (phase === "set" && msg.type === "buttons" && msg.buttons?.["4"]?.name === "blue") {
        const onDisk = JSON.parse(readFileSync(join(tmp, "arcade_buttons.json"), "utf-8"));
        if (onDisk.buttons["4"]?.color !== "blue" || onDisk.buttons["4"]?.notes !== "test note") {
          clearTimeout(timer);
          ws.close();
          reject(new Error(`disk write mismatch: ${JSON.stringify(onDisk)}`));
          return;
        }
        phase = "capture";
        ws.send(JSON.stringify({ type: "learn_capture" }));
        return;
      }

      if (phase === "capture" && msg.type === "error" && msg.code === "no_device") {
        phase = "clear-character";
        ws.send(
          JSON.stringify({
            type: "set_button",
            idx: 4,
            patch: { character: null },
          }),
        );
        return;
      }

      if (phase === "clear-character" && msg.type === "buttons" && !msg.buttons?.["4"]?.character) {
        phase = "set-action";
        ws.send(JSON.stringify({ type: "set_button", idx: 4, patch: { action: "replay" } }));
        return;
      }

      if (
        phase === "set-action" &&
        msg.type === "buttons" &&
        msg.buttons?.["4"]?.action === "replay"
      ) {
        phase = "clear-action";
        ws.send(JSON.stringify({ type: "set_button", idx: 4, patch: { action: null } }));
        return;
      }

      if (phase === "clear-action" && msg.type === "buttons" && !msg.buttons?.["4"]?.action) {
        phase = "set-empty-clear";
        ws.send(JSON.stringify({ type: "set_button", idx: 4, patch: { action: "replay" } }));
        return;
      }

      if (
        phase === "set-empty-clear" &&
        msg.type === "buttons" &&
        msg.buttons?.["4"]?.action === "replay"
      ) {
        phase = "empty-clear";
        ws.send(JSON.stringify({ type: "set_button", idx: 4, patch: { action: "" } }));
        return;
      }

      if (phase === "empty-clear" && msg.type === "buttons" && !msg.buttons?.["4"]?.action) {
        phase = "bad-name-null";
        ws.send(JSON.stringify({ type: "set_button", idx: 4, patch: { name: null } }));
        return;
      }

      if (phase === "bad-name-null" && msg.type === "error" && msg.code === "bad_message") {
        phase = "bad-both-set";
        ws.send(
          JSON.stringify({
            type: "set_button",
            idx: 4,
            patch: { character: "Leonardo", action: "replay" },
          }),
        );
        return;
      }

      if (phase === "bad-both-set" && msg.type === "error" && msg.code === "bad_message") {
        phase = "bad-empty-patch";
        ws.send(JSON.stringify({ type: "set_button", idx: 4, patch: {} }));
        return;
      }

      if (phase === "bad-empty-patch" && msg.type === "error" && msg.code === "bad_message") {
        phase = "remove";
        ws.send(JSON.stringify({ type: "remove_button", idx: 4 }));
        return;
      }

      if (phase === "remove" && msg.type === "buttons" && !msg.buttons?.["4"]) {
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

  console.log("panel-ws-buttons test OK:");
  console.log("  - get_buttons returns empty map");
  console.log("  - set_button roundtrips + persists color/notes to arcade_buttons.json");
  console.log("  - null clears character and action; empty string still clears action");
  console.log("  - name:null, both character+action, and empty patches return bad_message");
  console.log("  - learn_capture → no_device when encoder unavailable");
  console.log("  - remove_button deletes mapping");
  console.log("  - captureNextPress arm/disarm returns null without device");
}

main().catch((err) => {
  console.error("panel-ws-buttons test FAILED:", err.message ?? err);
  process.exit(1);
});
