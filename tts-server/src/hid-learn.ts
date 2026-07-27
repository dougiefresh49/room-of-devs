import { createInterface } from "readline";
import { HID } from "node-hid";
import {
  ARCADE_BUTTONS_PATH,
  DEFAULT_DEVICE_HINT,
  loadArcadeButtons,
  saveArcadeButtons,
  type ArcadeButton,
  type ArcadeButtons,
  type StickDirection,
  type StickMapping,
  type StickPole,
} from "./config.js";
import {
  makeDiffer,
  mappedAxisBytes,
  STICK_REARM_LO,
  STICK_REARM_HI,
  STICK_LEARN_MIN_DEV,
  STICK_LEARN_SAMPLE_MS,
} from "./hid-report.js";
import { findDevicePath } from "./hid-device.js";

// ── Learn mode ────────────────────────────────────────────────────
// Walk the physical buttons in a fixed order, record the HID index of the next
// button each one fires, and write arcade_buttons.json with sensible default
// bindings. Stick dirs are learned separately via hold-sample on axis bytes.
interface LearnSpec {
  name: string;
  def: Omit<ArcadeButton, "name">;
  prompt?: string;
}

const LEARN_ORDER: LearnSpec[] = [
  { name: "white", def: { action: "grant_next" } },
  { name: "blue", def: { character: "leonardo" } },
  { name: "red", def: { character: "raphael" } },
  { name: "teal", def: { character: "donatello" } },
  { name: "yellow", def: { character: "michelangelo" } },
  { name: "1p", def: { action: "replay" } },
  { name: "2p", def: { action: "stop" } },
  { name: "coin", def: { action: "cycle_mode", hold_action: "hold_room" } },
];

const STICK_DIRS: StickDirection[] = ["left", "right", "up", "down"];

function stickDirFromLearnName(name: string): StickDirection | null {
  const m = /^stick_(left|right|up|down)$/.exec(name);
  return m ? (m[1] as StickDirection) : null;
}

const LEARN_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function learn(): Promise<void> {
  const existing = loadArcadeButtons();
  const hint = existing.device_hint;
  const path = findDevicePath(hint);
  if (!path) {
    console.error(`No encoder found matching "${hint}". Plug it in and try again.`);
    process.exit(1);
  }

  let d: HID;
  try {
    d = new HID(path);
  } catch (err: any) {
    console.error(`Cannot open the encoder (${err?.message ?? err}).`);
    console.error("Most likely the tts-server daemon has it open (arcade_enabled=true).");
    console.error("Stop it, learn, then restart:");
    console.error("  ~/.cursor/tts/scripts/tts-server.sh stop");
    console.error("  pnpm exec tsx src/hid.ts learn ...");
    console.error("  ~/.cursor/tts/scripts/tts-server.sh start");
    console.error(
      "(Or capture through the Room panel: Settings > Buttons > input-code chip — that path works while the daemon runs.)",
    );
    process.exit(1);
  }

  let latestBuf: Buffer | null = null;
  let calibrated = false;
  const ldiff = makeDiffer((noisy) => {
    calibrated = true;
    console.log(`calibrated — masked ${noisy} noisy axis bit(s). Ready!\n`);
  });
  // During learn, skip runtime stick dispatch (mappedAxisBytes may be stale /
  // empty); we only want bit-edges for buttons + raw buffers for stick sample.
  mappedAxisBytes.clear();
  let onDown: ((idx: number) => void) | null = null;
  d.on("error", (err: any) => {
    console.error(`Device error: ${err?.message ?? err}`);
    process.exit(1);
  });
  d.on("data", (buf: Buffer) => {
    try {
      latestBuf = Buffer.from(buf);
      ldiff(buf, (edge, idx) => {
        if (edge === "down" && onDown) {
          const cb = onDown;
          onDown = null;
          cb(idx);
        }
      });
    } catch {
      /* ignore malformed report during learn */
    }
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const waitButton = (spec: LearnSpec): Promise<number | null> =>
    new Promise((resolve) => {
      let done = false;
      const label = `Press the ${spec.name.toUpperCase()} button now (or 's' + Enter to skip)... `;
      process.stdout.write(label);
      const finish = (v: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        rl.off("line", onLine);
        onDown = null;
        resolve(v);
      };
      const to = setTimeout(() => {
        process.stdout.write("(timeout, skipped)\n");
        finish(null);
      }, LEARN_TIMEOUT_MS);
      const onLine = (line: string) => {
        if (line.trim().toLowerCase() === "s") {
          process.stdout.write("(skipped)\n");
          finish(null);
        }
      };
      rl.on("line", onLine);
      onDown = (idx) => {
        process.stdout.write(`recorded index ${idx}\n`);
        finish(idx);
      };
    });

  async function learnStickDir(dir: StickDirection): Promise<StickMapping | null> {
    const dirLabel = dir.toUpperCase();

    const attempt = async (retry: boolean): Promise<StickMapping | "skip" | null> => {
      const prompt = retry
        ? `Not enough deflection — push the stick ${dirLabel} and HOLD it (or 's' + Enter to skip)... `
        : `push the stick ${dirLabel} and HOLD it (or 's' + Enter to skip)... `;

      let skipped = false;
      const onLine = (line: string) => {
        if (line.trim().toLowerCase() === "s") skipped = true;
      };
      rl.on("line", onLine);
      process.stdout.write(prompt);

      const baselines = ldiff.axisBaselines();
      // Digital (microswitch) sticks idle rock-steady, so calibration never
      // flags their axis bytes as candidates — sample EVERY byte instead,
      // baselined from the pre-push report (a 127 default would false-positive
      // on bytes that legitimately idle elsewhere, e.g. the hat at 0x0f).
      const baseSnapshot = latestBuf ? Buffer.from(latestBuf) : null;
      const start = Date.now();
      const peakAbs = new Map<number, number>();
      const peakSigned = new Map<number, number>();

      while (Date.now() - start < STICK_LEARN_SAMPLE_MS) {
        if (skipped) break;
        await sleep(20);
        if (!latestBuf) continue;
        const bytes = [...Array(latestBuf.length).keys()];
        for (const byte of bytes) {
          const base = baselines.get(byte) ?? baseSnapshot?.[byte] ?? 127;
          const v = latestBuf[byte] ?? base;
          const signed = v - base;
          const abs = Math.abs(signed);
          if (abs >= (peakAbs.get(byte) ?? 0)) {
            peakAbs.set(byte, abs);
            peakSigned.set(byte, signed);
          }
        }
      }
      rl.off("line", onLine);
      if (skipped) {
        process.stdout.write("(skipped)\n");
        return "skip";
      }

      let bestByte = -1;
      let bestAbs = 0;
      let bestSigned = 0;
      for (const [byte, abs] of peakAbs) {
        if (abs > bestAbs) {
          bestAbs = abs;
          bestByte = byte;
          bestSigned = peakSigned.get(byte) ?? 0;
        }
      }
      if (bestByte < 0 || bestAbs < STICK_LEARN_MIN_DEV) return null;
      const pole: StickPole = bestSigned < 0 ? "low" : "high";
      process.stdout.write(
        `recorded stick ${dir} → byte ${bestByte} pole ${pole} (dev ${bestSigned})\n`,
      );
      return { byte: bestByte, pole };
    };

    let result = await attempt(false);
    if (result === "skip") return null;
    if (!result) {
      result = await attempt(true);
      if (result === "skip" || !result) {
        if (result !== "skip") process.stdout.write("(skipped — still too weak)\n");
        return null;
      }
    }

    // Release gate: wait until axis returns near center so the next prompt
    // doesn't see leftover deflection.
    process.stdout.write("...release the stick and wait for center... ");
    const baselines = ldiff.axisBaselines();
    const releaseDeadline = Date.now() + LEARN_TIMEOUT_MS;
    while (Date.now() < releaseDeadline) {
      await sleep(40);
      if (!latestBuf) continue;
      const v = latestBuf[result.byte] ?? 127;
      const base = baselines.get(result.byte) ?? 127; // release gate tolerates either idle model via the REARM window below
      if (Math.abs(v - base) < 20 || (v >= STICK_REARM_LO && v <= STICK_REARM_HI)) {
        process.stdout.write("ok\n");
        return result;
      }
    }
    process.stdout.write("(timeout, continuing)\n");
    return result;
  }

  console.log("Learn mode — map each physical button / stick direction.");
  console.log("Calibrating: DON'T touch the buttons or joystick for 2 seconds...");
  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (calibrated) {
        clearInterval(poll);
        resolve();
      }
    }, 100);
    // If the device streams no reports at idle there's nothing to calibrate.
    setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, 4000);
  });

  // `learn <name>` = single-button / single-stick mode.
  const only = process.argv[3]?.trim().toLowerCase();
  let buttons: Record<string, ArcadeButton> = {};
  let sticks: Partial<Record<StickDirection, StickMapping>> = {
    ...(existing.sticks ?? {}),
  };
  let buttonOrder: LearnSpec[] = LEARN_ORDER;
  let stickOrder: StickDirection[] = STICK_DIRS;

  if (only) {
    const stickDir = stickDirFromLearnName(only);
    if (stickDir) {
      buttonOrder = [];
      stickOrder = [stickDir];
      buttons = { ...existing.buttons };
      delete sticks[stickDir];
    } else {
      stickOrder = [];
      buttons = { ...existing.buttons };
      const known = LEARN_ORDER.find((s) => s.name === only);
      buttonOrder = [known ?? { name: only, def: { action: "panel" } }];
      for (const [idx, b] of Object.entries(buttons)) {
        if (b.name === only) delete buttons[idx];
      }
    }
  } else {
    console.log("\n── Buttons ──");
    sticks = {}; // full learn rewrites sticks from scratch
  }

  for (const spec of buttonOrder) {
    const idx = await waitButton(spec);
    if (idx == null) continue;
    if (buttons[String(idx)]) {
      console.log(
        `  (index ${idx} already mapped to "${buttons[String(idx)].name}" — overwriting with "${spec.name}")`,
      );
    }
    buttons[String(idx)] = {
      ...(buttons[String(idx)] ?? {}),
      name: spec.name,
      ...spec.def,
    };
  }

  if (stickOrder.length > 0) {
    if (!only) console.log("\n── Stick ──");
    for (const dir of stickOrder) {
      const mapping = await learnStickDir(dir);
      if (mapping) sticks[dir] = mapping;
    }
  }

  const cfg: ArcadeButtons = {
    device_hint: hint || DEFAULT_DEVICE_HINT,
    buttons,
    ...(Object.keys(sticks).length > 0 ? { sticks } : {}),
  };
  saveArcadeButtons(cfg);
  console.log(`\nWrote ${ARCADE_BUTTONS_PATH}`);
  console.log(JSON.stringify(cfg, null, 2));

  rl.close();
  try {
    d.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
