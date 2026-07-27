#!/usr/bin/env node
// Guard against the PlayerSheet off-screen bug class (2026-07-27): a
// position/display class in a className OVERRIDE passed to an @room/ui
// primitive silently beats the primitive's own positioning via
// tailwind-merge (last-wins), dropping e.g. `fixed` and dumping the portal
// content into document flow. No formatter/linter can see this — Biome has
// no tailwind-conflict rule and the conflict spans two files — so this is
// a deliberate, narrow grep wired into `pnpm lint` and CI.
//
// Rule: JSX usages of the primitive *Content components must not pass
// position (fixed/absolute/relative/sticky/static) or inset-layout classes
// in className. If a surface genuinely needs one, the primitive should
// grow an explicit prop for it (like SheetContent's `side`/`overlayClassName`)
// — that keeps the merge deliberate instead of accidental.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const GUARDED = /<(Sheet|Dialog|DropdownMenu|DropdownMenuSub|Popover|Tooltip)Content\b/;
// Position keywords as standalone utilities (allow prefixed forms like
// md:relative? No — flag those too; variants merge the same way).
const BAD = /(?:^|[\s"'`:])(?:-?)(fixed|absolute|relative|sticky|static)(?=$|[\s"'`])/;

const ROOTS = ["packages/mobile/src", "packages/ui/src", "panel/src"];
const failures = [];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts|jsx)$/.test(name)) yield p;
  }
}

for (const root of ROOTS) {
  let files;
  try {
    files = [...walk(root)];
  } catch {
    continue;
  }
  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!GUARDED.test(lines[i])) continue;
      // Attribute span: same line for `<SheetContent className="...">`;
      // otherwise until the tag-closing line, which Biome formats as a
      // lone `>` / `/>`. Naive per-line `>` detection fails here — both
      // JSX comments (`<body>`) and arrow handlers (`() =>`) contain `>`.
      let end = i;
      if (!/>\s*$/.test(lines[i])) {
        while (end + 1 < lines.length && !/^\s*\/?>\s*$/.test(lines[end + 1])) end++;
      }
      for (let j = i; j <= end; j++) {
        if (/^\s*(?:\/\/|\{?\/\*)/.test(lines[j])) continue; // comments
        const cls = lines[j].match(/className=\{?["'`]([^"'`]*)["'`]/)?.[1];
        if (cls && BAD.test(cls)) {
          failures.push(
            `${file}:${j + 1} — position class "${cls.match(BAD)?.[1]}" in a primitive Content override (beats the primitive's positioning via tailwind-merge)`,
          );
        }
      }
      i = end;
    }
  }
}

if (failures.length) {
  console.error("check-class-overrides FAILED:\n" + failures.map((f) => `  ${f}`).join("\n"));
  console.error(
    "\nIf the positioning is intentional, add an explicit prop to the primitive instead of a raw class override.",
  );
  process.exit(1);
}
console.log("check-class-overrides: clean");
