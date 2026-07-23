import { pathToFileURL } from "url";
import { learn } from "./hid-learn.js";

// Phase 7 split: the runtime lives in hid-report / hid-actions / hid-device /
// hid-controller / hid-learn (import those directly). This file is only the
// documented CLI entry point: `pnpm exec tsx src/hid.ts learn [name]`.

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
