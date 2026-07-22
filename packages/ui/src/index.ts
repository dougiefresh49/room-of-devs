/**
 * @room/ui — shared UI layer for the Room of Devs panel + mobile room.
 *
 * Layers:
 *  - tokens.css / tailwind.css (import via "@room/ui/tokens.css" etc.)
 *  - lib: cn(), initials()
 *  - primitives: vendored shadcn-style wrappers over Radix
 *  - components: domain leaf components (props + callbacks only)
 *  - markdown: sanitized renderer + stripMarkdown
 *
 * Hard rule: nothing in this package touches fetch/WS/Tauri/audio.
 */
export { cn } from "./lib/cn.js";
export { initials } from "./lib/initials.js";

export * from "./primitives/button.js";
export * from "./primitives/dialog.js";
export * from "./primitives/sheet.js";
export * from "./primitives/popover.js";
export * from "./primitives/dropdown-menu.js";
export * from "./primitives/toggle-group.js";
export * from "./primitives/tooltip.js";
export * from "./primitives/toast.js";

export * from "./components/StateBadge.js";
export * from "./components/AgentChips.js";
export * from "./components/QueuedPreview.js";
export * from "./components/TransportBar.js";
export * from "./components/SummaryText.js";
export * from "./components/icons.js";

export { Markdown, type LinkPolicy } from "./markdown/Markdown.js";
export { stripMarkdown } from "./markdown/strip.js";
