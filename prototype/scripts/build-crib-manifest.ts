/**
 * Generates prototype/src/crib/crib-manifest.ts from exports + grep + audit metadata.
 * Run: pnpm exec tsx prototype/scripts/build-crib-manifest.ts
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "prototype/src/crib/crib-manifest.ts");

type Surface = "console" | "field" | "panel" | "mobile";
type Drawer = "rig" | "shadcn" | "domain" | "proto-ext";

type Provenance =
  | { kind: "custom" }
  | { kind: "radix"; base: string }
  | { kind: "cva" }
  | { kind: "lib"; base: string };

interface InstrumentSeed {
  id: string;
  name: string;
  drawer: Drawer;
  provenance: Provenance;
  path: string;
  importSymbols: string[];
  states: string[];
  props: { name: string; type: string; note: string }[];
  registryEquivalent?: string;
  verdict?: string;
  defect?: string;
}

const ADOPTION_CAVEAT =
  "Vendor the Radix behavior, drop shadcn's palette, restyle against packages/ui/src/tokens.css. Never run shadcn add with a theme.";

const INSTRUMENTS: InstrumentSeed[] = [
  {
    id: "RIG-001",
    name: "CutFrame",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/CutFrame.tsx",
    importSymbols: ["CutFrame"],
    states: ["scale L", "scale M", "scale S", "glow"],
    props: [
      { name: "scale", type: '"L" | "M" | "S"', note: "chamfer grammar" },
      { name: "glow", type: "boolean", note: "drop-shadow halo" },
      { name: "children", type: "ReactNode", note: "clipped content" },
    ],
    registryEquivalent: "card",
    verdict:
      "Overlaps rig/Chassis.tsx + rig/Bay.tsx; RIG chamfer styling makes it a net loss. Skip.",
  },
  {
    id: "RIG-002",
    name: "Chassis",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/Chassis.tsx",
    importSymbols: ["Chassis"],
    states: ["default", "mainwin"],
    props: [
      { name: "className", type: "string", note: "housing modifier" },
      { name: "children", type: "ReactNode", note: "plate body" },
    ],
    registryEquivalent: "card",
    verdict:
      "Overlaps rig/Chassis.tsx + rig/Bay.tsx; RIG chamfer styling makes it a net loss. Skip.",
  },
  {
    id: "RIG-003",
    name: "Bay",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/Bay.tsx",
    importSymbols: ["Bay"],
    states: ["default", "nested"],
    props: [
      { name: "label", type: "ReactNode", note: "stencil header" },
      { name: "children", type: "ReactNode", note: "bay interior" },
    ],
    registryEquivalent: "card",
    verdict:
      "Overlaps rig/Chassis.tsx + rig/Bay.tsx; RIG chamfer styling makes it a net loss. Skip.",
  },
  {
    id: "RIG-004",
    name: "ScreenBed",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/ScreenBed.tsx",
    importSymbols: ["ScreenBed"],
    states: ["default", "CRT tint"],
    props: [
      { name: "children", type: "ReactNode", note: "phosphor bed" },
      { name: "className", type: "string", note: "layout hook" },
    ],
    registryEquivalent: "card",
    verdict:
      "Overlaps rig/Chassis.tsx + rig/Bay.tsx; RIG chamfer styling makes it a net loss. Skip.",
  },
  {
    id: "RIG-005",
    name: "Tag",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/Tag.tsx",
    importSymbols: ["Tag"],
    states: ["default", "amber", "red", "green", "dim"],
    props: [
      { name: "tone", type: "TagTone", note: "semantic color" },
      { name: "children", type: "ReactNode", note: "stencil text" },
    ],
    registryEquivalent: "badge",
    verdict:
      "Would unify bespoke badges but those carry semantic state colors from tokens.css; a badge migration is a restyle, not a simplification. Skip.",
  },
  {
    id: "RIG-006",
    name: "Waveform",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/Waveform.tsx",
    importSymbols: ["Waveform"],
    states: ["active", "flat idle"],
    props: [
      { name: "active", type: "boolean", note: "bars animate when true" },
      { name: "bars", type: "number", note: "bar count (default 12)" },
    ],
    registryEquivalent: "chart",
    verdict:
      "Hand-drawn SVG plots carry the RIG phosphor look; Recharts fights custom SVG art. Considered and rejected.",
  },
  {
    id: "RIG-007",
    name: "Led",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/Led.tsx",
    importSymbols: ["Led"],
    states: ["amber", "green", "red", "dim", "pulse", "pulse hot"],
    props: [
      { name: "tone", type: "LedTone", note: "lamp color" },
      { name: "pulse", type: "boolean", note: "CSS pulse animation" },
      { name: "pulseSpeed", type: '"default" | "hot"', note: "pulse rate" },
    ],
    registryEquivalent: "spinner",
    verdict: "No spinner exists today; Led/Waveform carry busy state. Skip.",
  },
  {
    id: "RIG-008",
    name: "Keycap",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/Keycap.tsx",
    importSymbols: ["Keycap"],
    states: ["default", "armed glow"],
    props: [
      { name: "children", type: "ReactNode", note: "legend" },
      { name: "armed", type: "boolean", note: "hot detent glow" },
      { name: "onClick", type: "() => void", note: "activation" },
    ],
    registryEquivalent: "kbd",
    verdict: "rig/Keycap.tsx already does this with far more character. Skip.",
  },
  {
    id: "RIG-009",
    name: "HexLayer",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/HexLayer.tsx",
    importSymbols: ["HexLayer"],
    states: ["faint", "dim", "mid", "hot"],
    props: [
      { name: "intensity", type: "HexIntensity", note: "backdrop strength" },
      { name: "className", type: "string", note: "positioning" },
    ],
  },
  {
    id: "RIG-010",
    name: "Odometer",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/Odometer.tsx",
    importSymbols: ["Odometer"],
    states: ["digits 0–9", "leading zeros"],
    props: [
      { name: "value", type: "number | string", note: "readout" },
      { name: "digits", type: "number", note: "pad width" },
    ],
  },
  {
    id: "RIG-011",
    name: "DialGauge",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/DialGauge.tsx",
    importSymbols: ["DialGauge"],
    states: ["arc 0–1", "redline zone", "cold", "caption"],
    props: [
      { name: "fraction", type: "number 0–1", note: "amber arc fill" },
      { name: "redlineFrom", type: "number", note: "red arc from here" },
      { name: "caption", type: "ReactNode", note: "stencil under dial" },
    ],
    registryEquivalent: "chart",
    verdict:
      "The nearest registry analogue is chart's radial family, and none of them would survive the restyle. Leave these alone.",
    defect:
      "Session arc belongs in DialGauge — prototype composes it in SessionDial until sessionFraction ships upstream.",
  },
  {
    id: "RIG-012",
    name: "CrtFace",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/CrtFace.tsx",
    importSymbols: ["CrtFace"],
    states: ["sm", "md", "lg", "scanlines", "blink"],
    props: [
      { name: "size", type: "CrtFaceSize", note: "housing scale" },
      { name: "children", type: "ReactNode", note: "face content" },
    ],
    registryEquivalent: "avatar",
    verdict:
      "Avatars are lipsync-driven img refs that must never re-render through React. avatar would fight the stage engine. Do not adopt.",
  },
  {
    id: "RIG-013",
    name: "SalienceBar",
    drawer: "rig",
    provenance: { kind: "custom" },
    path: "packages/ui/src/rig/SalienceBar.tsx",
    importSymbols: ["SalienceBar"],
    states: ["fill %", "threshold notch", "dim segment"],
    props: [
      { name: "value", type: "number 0–100", note: "amber fill" },
      { name: "threshold", type: "number", note: "gate notch position" },
    ],
    registryEquivalent: "progress",
    verdict: "Overlaps rig/SalienceBar.tsx; segmented amber look would be lost. Skip.",
  },
  {
    id: "SHD-001",
    name: "button",
    drawer: "shadcn",
    provenance: { kind: "cva" },
    path: "packages/ui/src/primitives/button.tsx",
    importSymbols: ["Button", "buttonVariants"],
    states: ["default", "outline", "ghost", "destructive", "sm", "icon"],
    props: [
      { name: "variant", type: "ButtonVariant", note: "CVA variant" },
      { name: "size", type: "ButtonSize", note: "CVA size" },
    ],
    registryEquivalent: "button",
    verdict: "Live — barely. Single consumer in prototype; panel/mobile use raw icon-btn.",
  },
  {
    id: "SHD-002",
    name: "dialog",
    drawer: "shadcn",
    provenance: { kind: "radix", base: "DIALOG" },
    path: "packages/ui/src/primitives/dialog.tsx",
    importSymbols: [
      "Dialog",
      "DialogContent",
      "DialogTrigger",
      "DialogTitle",
      "DialogHeader",
      "DialogOverlay",
      "DialogClose",
    ],
    states: ["open", "closed", "modal overlay"],
    props: [
      { name: "open", type: "boolean", note: "controlled root" },
      { name: "onOpenChange", type: "(open: boolean) => void", note: "state callback" },
    ],
    registryEquivalent: "dialog",
    verdict:
      "Vendored, dead in audit — exactly what ControlDeck.tsx hand-rolls with role=dialog and a manual keydown listener. Round D adopted Radix dialog in the prototype.",
  },
  {
    id: "SHD-003",
    name: "command",
    drawer: "shadcn",
    provenance: { kind: "lib", base: "CMDK" },
    path: "packages/ui/src/primitives/command.tsx",
    importSymbols: [
      "Command",
      "CommandInput",
      "CommandList",
      "CommandItem",
      "CommandGroup",
      "CommandEmpty",
      "CommandShortcut",
    ],
    states: ["palette open", "filtering", "empty"],
    props: [
      { name: "value", type: "string", note: "filter value" },
      { name: "onValueChange", type: "(v: string) => void", note: "filter callback" },
    ],
    registryEquivalent: "command",
    verdict:
      "Control deck IS a command palette hand-built from a backtick keydown listener; command covers it with fuzzy filtering.",
  },
  {
    id: "SHD-004",
    name: "dropdown-menu",
    drawer: "shadcn",
    provenance: { kind: "radix", base: "DROPDOWN-MENU" },
    path: "packages/ui/src/primitives/dropdown-menu.tsx",
    importSymbols: [
      "DropdownMenu",
      "DropdownMenuTrigger",
      "DropdownMenuContent",
      "DropdownMenuItem",
    ],
    states: ["closed", "open", "item hover"],
    props: [{ name: "modal", type: "boolean", note: "Radix modal behavior" }],
  },
  {
    id: "SHD-005",
    name: "popover",
    drawer: "shadcn",
    provenance: { kind: "radix", base: "POPOVER" },
    path: "packages/ui/src/primitives/popover.tsx",
    importSymbols: ["Popover", "PopoverTrigger", "PopoverContent"],
    states: ["closed", "open", "anchored"],
    props: [{ name: "open", type: "boolean", note: "controlled" }],
  },
  {
    id: "SHD-006",
    name: "sheet",
    drawer: "shadcn",
    provenance: { kind: "radix", base: "DIALOG" },
    path: "packages/ui/src/primitives/sheet.tsx",
    importSymbols: ["Sheet", "SheetContent", "SheetHeader", "SheetTitle", "SheetDescription"],
    states: ["side bottom", "side right", "open"],
    props: [{ name: "side", type: '"top" | "right" | "bottom" | "left"', note: "slide edge" }],
  },
  {
    id: "SHD-007",
    name: "toggle-group",
    drawer: "shadcn",
    provenance: { kind: "radix", base: "TOGGLE-GROUP" },
    path: "packages/ui/src/primitives/toggle-group.tsx",
    importSymbols: ["ToggleGroup", "ToggleGroupItem"],
    states: ["single", "multi", "on/off items"],
    props: [
      { name: "type", type: '"single" | "multiple"', note: "selection mode" },
      { name: "value", type: "string | string[]", note: "controlled value" },
    ],
  },
  {
    id: "SHD-008",
    name: "tooltip",
    drawer: "shadcn",
    provenance: { kind: "radix", base: "TOOLTIP" },
    path: "packages/ui/src/primitives/tooltip.tsx",
    importSymbols: ["Tooltip", "TooltipTrigger", "TooltipContent", "TooltipProvider"],
    states: ["closed", "open", "delayed"],
    props: [{ name: "delayDuration", type: "number", note: "provider default delay" }],
    registryEquivalent: "tooltip",
    verdict:
      'Vendored, dead; would replace dozens of native title="" attributes with accessible, styled hints.',
  },
  {
    id: "SHD-009",
    name: "toast",
    drawer: "shadcn",
    provenance: { kind: "lib", base: "SONNER" },
    path: "packages/ui/src/primitives/toast.tsx",
    importSymbols: ["Toaster", "toast"],
    states: ["queued", "visible", "dismissed"],
    props: [{ name: "position", type: "ToasterPosition", note: "sonner placement" }],
    registryEquivalent: "sonner",
    verdict:
      "Vendored, dead — highest effort-to-payoff in the audit; panel and mobile still hand-roll toast timers.",
  },
  {
    id: "DOM-001",
    name: "StateBadge",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/StateBadge.tsx",
    importSymbols: ["StateBadge"],
    states: ["working", "handRaised", "idle", "needsYou"],
    props: [
      { name: "state", type: "AgentState", note: "protocol state" },
      { name: "label", type: "string", note: "optional override" },
    ],
    registryEquivalent: "badge",
    verdict: "Fully custom dot + label; registry badge would fight semantic state colors. Skip.",
  },
  {
    id: "DOM-002",
    name: "AgentChips",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/AgentChips.tsx",
    importSymbols: ["AgentChips"],
    states: ["multi agent", "overflow"],
    props: [{ name: "agents", type: "AgentChip[]", note: "persona list" }],
    registryEquivalent: "badge",
    verdict: "Fully custom. Registry equivalent: badge. Skip.",
  },
  {
    id: "DOM-003",
    name: "LiveBadge",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/LiveBadge.tsx",
    importSymbols: ["LiveBadge"],
    states: ["live", "off"],
    props: [{ name: "live", type: "boolean", note: "pulse when live" }],
    registryEquivalent: "badge",
    verdict: "Fully custom. Skip.",
  },
  {
    id: "DOM-004",
    name: "FailedCountBadge",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/FailedCountBadge.tsx",
    importSymbols: ["FailedCountBadge"],
    states: ["zero hidden", "count shown"],
    props: [{ name: "count", type: "number", note: "failed items" }],
    registryEquivalent: "badge",
    verdict: "Fully custom. Skip.",
  },
  {
    id: "DOM-005",
    name: "QueuedPreview",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/QueuedPreview.tsx",
    importSymbols: ["QueuedPreview"],
    states: ["truncated quote"],
    props: [{ name: "text", type: "string", note: "preview line" }],
  },
  {
    id: "DOM-006",
    name: "GrantButton",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/GrantButton.tsx",
    importSymbols: ["GrantButton"],
    states: ["idle", "holding PTT", "disabled"],
    props: [
      { name: "onGrant", type: "() => void", note: "tap grant" },
      { name: "onHoldStart", type: "() => void", note: "optional PTT" },
      { name: "holdMs", type: "number", note: "hold threshold" },
    ],
    registryEquivalent: "button",
    verdict: "Does not use our Button primitive — bespoke hold semantics. Skip migration.",
  },
  {
    id: "DOM-007",
    name: "TransportBar",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/TransportBar.tsx",
    importSymbols: ["TransportBar"],
    states: ["playing", "paused", "disabled controls"],
    props: [{ name: "onPlay", type: "() => void", note: "transport callbacks" }],
    registryEquivalent: "button-group",
    verdict: "Maps onto TransportBar / ActionCluster; styling-only win. Optional.",
  },
  {
    id: "DOM-008",
    name: "SummaryText",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/SummaryText.tsx",
    importSymbols: ["SummaryText"],
    states: ["markdown summary", "plain"],
    props: [
      { name: "text", type: "string", note: "source" },
      { name: "linkPolicy", type: "LinkPolicy", note: "inert vs external" },
    ],
  },
  {
    id: "DOM-009",
    name: "Markdown",
    drawer: "domain",
    provenance: { kind: "lib", base: "REACT-MARKDOWN" },
    path: "packages/ui/src/markdown/Markdown.tsx",
    importSymbols: ["Markdown"],
    states: ["headings", "links inert", "links external"],
    props: [
      { name: "text", type: "string", note: "markdown source" },
      { name: "linkPolicy", type: '"inert" | "external"', note: "link behavior" },
    ],
    verdict: "Not a registry concept — react-markdown + rehype-sanitize + remark-breaks.",
  },
  {
    id: "DOM-010",
    name: "icons",
    drawer: "domain",
    provenance: { kind: "custom" },
    path: "packages/ui/src/components/icons.tsx",
    importSymbols: ["IconPlay", "IconPause", "IconStop", "IconReplay"],
    states: ["24×24 SVG set"],
    props: [{ name: "className", type: "string", note: "size hook" }],
    verdict: "Hand-drawn SVGs — Lucide reserved for vendored primitives.",
  },
  {
    id: "EXT-001",
    name: "FieldCard",
    drawer: "proto-ext",
    provenance: { kind: "custom" },
    path: "prototype/src/rig-ext/FieldCard.tsx",
    importSymbols: ["FieldCard"],
    states: ["compact card", "CutFrame wrap"],
    props: [{ name: "children", type: "ReactNode", note: "card body" }],
  },
  {
    id: "EXT-002",
    name: "FieldCrtFace",
    drawer: "proto-ext",
    provenance: { kind: "custom" },
    path: "prototype/src/rig-ext/FieldCrtFace.tsx",
    importSymbols: ["FieldCrtFace"],
    states: ["40px", "148px field sizes"],
    props: [{ name: "size", type: "40 | 148", note: "field CRT scale" }],
  },
  {
    id: "EXT-003",
    name: "SessionDial",
    drawer: "proto-ext",
    provenance: { kind: "custom" },
    path: "prototype/src/rig-ext/SessionDial.tsx",
    importSymbols: ["SessionDial"],
    states: ["window arc", "session arc", "redline"],
    props: [
      { name: "fraction", type: "number", note: "spend window" },
      { name: "sessionFraction", type: "number | null", note: "blue outer arc" },
      { name: "redlineFrom", type: "number", note: "red arc threshold" },
    ],
  },
];

const DEAD_STOCK_NOTES: Record<string, { handRolledBy: string; verdict: string }> = {
  dialog: {
    handRolledBy: 'prototype/src/deck/ControlDeck.tsx — role="dialog" + manual keydown listener.',
    verdict: "ADOPT",
  },
  command: {
    handRolledBy:
      "prototype/src/deck/ControlDeck.tsx — backtick listener + manually filtered button list.",
    verdict: "ADOPT",
  },
  toast: {
    handRolledBy:
      "panel/src/app/App.tsx + packages/mobile/src/components/Toast.tsx + view-state timers.",
    verdict: "ADOPT — HIGHEST PAYOFF IN THE AUDIT",
  },
  tooltip: {
    handRolledBy: 'native title="" attributes across all four surfaces.',
    verdict: "ADOPT FOR A11Y, OR SCRAP THE DEP",
  },
  TransportBar: {
    handRolledBy: "panel/src/app/ActionCluster.tsx and mobile transport icon-button clusters.",
    verdict: "SCRAP UNTIL A REAL SHARED CONSUMER REPLACES THOSE CLUSTERS",
  },
  FieldCard: {
    handRolledBy: "field screens using raw chassis/view-terminal wrappers.",
    verdict: "ADOPT IN FIELD OR SCRAP THE EXTENSION",
  },
  FieldCrtFace: {
    handRolledBy: "field screens sizing CrtFace wells directly.",
    verdict: "ADOPT IN FIELD OR FOLD THE SIZES INTO CRTFACE",
  },
  SessionDial: {
    handRolledBy: "GaugesScreen composing the session arc around DialGauge.",
    verdict: "ADOPT UNTIL SESSIONFRACTION SHIPS UPSTREAM, THEN SCRAP",
  },
};

const WORK_ORDERS = [
  {
    id: "wo-tabs",
    title: "TABS",
    callSites: [
      "panel/src/app/PickerView.tsx:397",
      "panel/src/app/SettingsView.tsx:558",
      "packages/mobile/src/components/PickerSheet.tsx:125",
    ],
    payoff: "One primitive, three deletions, plus keyboard a11y we currently lack.",
    note: "Round-D consumer: the crib's own drawer rail.",
  },
  {
    id: "wo-sonner",
    title: "SONNER",
    callSites: [
      "packages/ui/src/primitives/toast.tsx (vendored)",
      "panel/src/app/App.tsx:114",
      "packages/mobile/src/components/Toast.tsx",
    ],
    payoff: "Wiring the existing toast primitive deletes a whole file and two timer states.",
    note: "Round-D consumer: the STRIKE BERTH receipt (commissioning bay).",
  },
  {
    id: "wo-native-select",
    title: "NATIVE-SELECT",
    callSites: [
      "panel/src/app/SettingsView.tsx:217",
      "panel/src/app/SettingsView.tsx:408",
      "panel/src/app/PickerView.tsx:446",
      "packages/mobile/src/components/PickerSheet.tsx:250",
    ],
    payoff: "Low-risk — keeps the OS picker on phone, styles the four raw <select>s.",
    note: "",
  },
  {
    id: "wo-command",
    title: "COMMAND (cmdk)",
    callSites: ["prototype/src/deck/ControlDeck.tsx", "panel/src/app/PickerView.tsx (505 lines)"],
    payoff: "Fuzzy filtering for free; control deck and agent picker share one primitive.",
    note: "Round-D consumer #2 on day one: the ⌘K room-switcher palette in the hangar.",
  },
  {
    id: "wo-slider",
    title: "SLIDER",
    callSites: ["panel/src/app/SettingsView.tsx:275"],
    payoff: "Bare type=range on a floating NSPanel is awkward to hit.",
    note: "",
  },
];

function grepConsumers(): Map<string, Set<string>> {
  const bySymbol = new Map<string, Set<string>>();
  const files = execSync(
    `rg --files panel/src packages/mobile/src prototype/src -g '*.tsx' -g '*.ts'`,
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .sort();

  for (const file of files) {
    // Rendering a part in its catalog fixture is not product adoption.
    if (file === "prototype/src/crib/specimens.tsx") continue;
    const sourceText = readFileSync(join(ROOT, file), "utf8");
    const importPattern = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
    for (const match of sourceText.matchAll(importPattern)) {
      const source = match[2]!;
      const isSharedUi = source === "@room/ui" || source.startsWith("@room/ui/");
      const isPrototypeRigExtension = source.includes("rig-ext/");
      if (!isSharedUi && !isPrototypeRigExtension) continue;
      const symbols = match[1]!
        .split(",")
        .map((symbol) =>
          symbol
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]
            ?.trim(),
        )
        .filter(Boolean) as string[];
      for (const symbol of symbols) {
        if (!bySymbol.has(symbol)) bySymbol.set(symbol, new Set());
        bySymbol.get(symbol)!.add(file);
      }
    }
  }
  return bySymbol;
}

function surfaceFor(file: string): Surface {
  if (file.startsWith("panel/")) return "panel";
  if (file.startsWith("packages/mobile/")) return "mobile";
  if (file.includes("/field/")) return "field";
  return "console";
}

function consumersFor(seed: InstrumentSeed, bySymbol: Map<string, Set<string>>): string[] {
  const paths = new Set<string>();
  for (const sym of seed.importSymbols) {
    const hits = bySymbol.get(sym);
    if (hits) for (const p of hits) paths.add(p);
  }
  return [...paths].sort();
}

function surfacesFromConsumers(paths: string[]): Surface[] {
  const s = new Set<Surface>();
  for (const p of paths) s.add(surfaceFor(p));
  return [...s].sort();
}

const bySymbol = grepConsumers();

const instruments = INSTRUMENTS.map((seed) => {
  const { importSymbols, ...meta } = seed;
  const consumers = consumersFor(seed, bySymbol);
  return {
    ...meta,
    consumers,
    surfaces: surfacesFromConsumers(consumers),
  };
});

const deadStockBin = instruments
  .filter((instrument) => instrument.consumers.length === 0)
  .map((instrument) => {
    const note = DEAD_STOCK_NOTES[instrument.name] ?? {
      handRolledBy: "No importing call site was detected outside the catalog specimen.",
      verdict: "SCRAP UNLESS A REAL CONSUMER IS IDENTIFIED",
    };
    return {
      id: `dead-${instrument.id.toLowerCase()}`,
      name: instrument.name,
      provenance: instrument.provenance,
      ...note,
    };
  });

const generated = `/* eslint-disable */
/** AUTO-GENERATED by prototype/scripts/build-crib-manifest.ts — do not edit by hand. */

export type Surface = "console" | "field" | "panel" | "mobile";

export type Provenance =
  | { kind: "custom" }
  | { kind: "radix"; base: string }
  | { kind: "cva" }
  | { kind: "lib"; base: string };

export interface Instrument {
  id: string;
  name: string;
  drawer: "rig" | "shadcn" | "domain" | "proto-ext";
  provenance: Provenance;
  registryEquivalent?: string;
  verdict?: string;
  path: string;
  consumers: string[];
  surfaces: Surface[];
  states: string[];
  props: { name: string; type: string; note: string }[];
  defect?: string;
}

export interface DeadStockEntry {
  id: string;
  name: string;
  provenance: Provenance;
  handRolledBy: string;
  verdict: string;
}

export interface WorkOrder {
  id: string;
  title: string;
  callSites: string[];
  payoff: string;
  note: string;
}

export const adoptionCaveat = ${JSON.stringify(ADOPTION_CAVEAT)};

export const deadStockBin: DeadStockEntry[] = ${JSON.stringify(deadStockBin, null, 2)};

export const workOrders: WorkOrder[] = ${JSON.stringify(WORK_ORDERS, null, 2)};

export const instruments: Instrument[] = ${JSON.stringify(instruments, null, 2)};

export function countByDrawer(drawer: Instrument["drawer"] | "all"): number {
  if (drawer === "all") return instruments.length;
  return instruments.filter((i) => i.drawer === drawer).length;
}

export function stockLampCount(consumers: string[]): number {
  return consumers.length;
}

export function fragileCount(): number {
  return instruments.filter((i) => i.consumers.length === 1).length;
}

export function deadStockCount(): number {
  return instruments.filter((i) => i.consumers.length === 0).length;
}

export function drawerLabels(): { id: string; label: string; count: number }[] {
  return [
    { id: "all", label: "ALL DRAWERS", count: instruments.length },
    { id: "rig", label: "RIG", count: countByDrawer("rig") },
    { id: "shadcn", label: "SHADCN", count: countByDrawer("shadcn") },
    { id: "domain", label: "DOMAIN", count: countByDrawer("domain") },
    { id: "proto-ext", label: "PROTO-EXT", count: countByDrawer("proto-ext") },
    { id: "dead-stock", label: "DEAD STOCK", count: deadStockCount() },
    { id: "work-orders", label: "WORK ORDERS", count: workOrders.length },
  ];
}
`;

writeFileSync(OUT, generated, "utf8");
console.log(`Wrote ${OUT} (${instruments.length} instruments)`);
