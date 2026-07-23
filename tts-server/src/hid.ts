import { pathToFileURL } from "url";
import {
  type Differ,
  type StickArmState,
  evaluateStickAxis,
} from "./hid-report.js";
import { HID_ACTIONS, type HidAction } from "./hid-actions.js";
import { startHid, stopHid } from "./hid-device.js";
import { captureNextPress, isCaptureReady } from "./hid-controller.js";
import { learn } from "./hid-learn.js";

export type { Differ, StickArmState, HidAction };
export {
  evaluateStickAxis,
  HID_ACTIONS,
  startHid,
  stopHid,
  captureNextPress,
  isCaptureReady,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "learn") {
    learn().catch((err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    });
  } else {
    console.error("Usage: tsx src/hid.ts learn [name]");
    process.exit(1);
  }
}
