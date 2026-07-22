import { Markdown, type LinkPolicy } from "../markdown/Markdown.js";

/**
 * The spoken-summary body (room summary pane, dock caption expanded view,
 * mobile thread messages in Phase 5): sanitized markdown, links per
 * platform policy. Prefers the pre-Gemini raw text when present.
 */
export interface SummaryTextProps {
  text: string;
  rawText?: string | null;
  linkPolicy?: LinkPolicy;
  className?: string;
}

export function SummaryText({ text, rawText, linkPolicy = "inert", className }: SummaryTextProps) {
  const body = (rawText?.trim() || text).trim();
  return <Markdown text={body} linkPolicy={linkPolicy} className={className} />;
}
