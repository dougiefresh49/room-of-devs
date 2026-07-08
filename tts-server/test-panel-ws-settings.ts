/**
 * Scratch WS test for settings feed/dispatch — uses TTS_DIR_OVERRIDE, no daemon/APIs.
 * Run: pnpm exec tsx test-panel-ws-settings.ts
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "fs";
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

function writeStubScript(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "panel-ws-settings-"));
  const port = await findFreePort();

  process.env.TTS_DIR_OVERRIDE = tmp;
  mkdirSync(join(tmp, "state"), { recursive: true });
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  mkdirSync(join(tmp, "tts-server"), { recursive: true });
  mkdirSync(join(tmp, "cache"), { recursive: true });

  writeFileSync(
    join(tmp, "config.json"),
    JSON.stringify(
      {
        panel_port: port,
        arcade_enabled: false,
        default_speed: 1.25,
        playback_mode: "announce",
        notifications_enabled: false,
        notification_sound: "random_sfx",
        dynamic_responses: "always",
        elevenlabs_voice_id: "v1",
      },
      null,
      2
    )
  );
  writeFileSync(
    join(tmp, "arcade_buttons.json"),
    JSON.stringify({ device_hint: "test-joystick", buttons: { "1": { name: "rm" } } }, null, 2)
  );
  writeFileSync(
    join(tmp, "cache", "voices.json"),
    JSON.stringify(
      [
        { voice_id: "v1", name: "Leo Voice", category: "premade" },
        { voice_id: "v9", name: "Other", category: "premade" },
      ],
      null,
      2
    )
  );
  writeFileSync(join(tmp, "listening.enabled"), "1\n");

  const scriptsDir = join(tmp, "scripts");
  writeStubScript(
    join(scriptsDir, "set_speed.sh"),
    `TTS_DIR="\${TTS_DIR:-$HOME/.cursor/tts}"
python3 -c "
import json, sys
speed = float(sys.argv[1])
path = sys.argv[2]
with open(path) as f:
    c = json.load(f)
c['default_speed'] = speed
with open(path, 'w') as f:
    json.dump(c, f, indent=2)
    f.write('\\n')
" "$1" "$TTS_DIR/config.json"`
  );
  writeStubScript(
    join(scriptsDir, "set_listening.sh"),
    `TTS_DIR="\${TTS_DIR:-$HOME/.cursor/tts}"
case "$1" in on) echo 1 > "$TTS_DIR/listening.enabled" ;; off) echo 0 > "$TTS_DIR/listening.enabled" ;; *) exit 1 ;; esac`
  );

  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "src");
  writeFileSync(
    join(srcDir, "characters.json"),
    JSON.stringify({ v1: { name: "Leonardo" } }, null, 2)
  );

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
    }, 8000);
    let phase: "init" | "set" | "buttons" | "remove" = "init";

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());

      if (phase === "init" && msg.type === "snapshot") {
        ws.send(JSON.stringify({ type: "get_settings" }));
        return;
      }

      if (phase === "init" && msg.type === "settings") {
        const v = msg.values ?? {};
        if (v.default_speed !== 1.25) throw new Error(`expected speed 1.25, got ${v.default_speed}`);
        if (v.playback_mode !== "announce") throw new Error(`bad playback_mode: ${v.playback_mode}`);
        if (v.mood !== "custom") throw new Error(`expected custom mood, got ${v.mood}`);
        if (v.default_voice_id !== "v1" || v.default_voice_name !== "Leonardo") {
          throw new Error(`voice resolve failed: ${JSON.stringify(v)}`);
        }
        if (v.listening !== true) throw new Error("expected listening true");
        phase = "set";
        ws.send(JSON.stringify({ type: "set_setting", key: "speed", value: 1.5 }));
        return;
      }

      if (phase === "set" && msg.type === "settings") {
        if (msg.values?.default_speed !== 1.5) {
          clearTimeout(timer);
          ws.close();
          reject(new Error(`set_setting speed failed: ${JSON.stringify(msg.values)}`));
          return;
        }
        const onDisk = JSON.parse(readFileSync(join(tmp, "config.json"), "utf-8"));
        if (onDisk.default_speed !== 1.5) {
          clearTimeout(timer);
          ws.close();
          reject(new Error(`config.json not updated: ${JSON.stringify(onDisk)}`));
          return;
        }
        phase = "buttons";
        ws.send(JSON.stringify({ type: "get_buttons" }));
        return;
      }

      if (phase === "buttons" && msg.type === "buttons" && msg.buttons?.["1"]) {
        phase = "remove";
        ws.send(JSON.stringify({ type: "remove_button", idx: 1 }));
        return;
      }

      if (phase === "remove" && msg.type === "buttons" && !msg.buttons?.["1"]) {
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

  console.log("panel-ws-settings test OK:");
  console.log("  - get_settings returns resolved values");
  console.log("  - set_setting(speed) roundtrips + persists config.json");
  console.log("  - remove_button replies fresh buttons to requesting socket");
}

main().catch((err) => {
  console.error("panel-ws-settings test FAILED:", err.message ?? err);
  process.exit(1);
});
