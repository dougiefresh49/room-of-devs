function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(line: string): string {
  const code: string[] = [];
  let html = line.replace(/`([^`\n]+)`/g, (_match, value: string) => {
    const token = `@@CODE${code.length}@@`;
    code.push(`<code>${value}</code>`);
    return token;
  });
  html = html.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, '<span class="md-link" title="$2">$1</span>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return html.replace(/@@CODE(\d+)@@/g, (_match, index: string) => code[Number(index)] ?? "");
}

export function stripMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*]|\d+\.)\s+/gm, "")
    .replace(/^\s{0,3}---+\s*$/gm, "")
    .trim();
}

export function renderMarkdown(raw: string): string {
  const lines = escapeHtml(raw).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  let codeLines: string[] = [];
  const closeParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.join("<br>")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };
  const openList = (nextType: "ul" | "ol") => {
    if (listType === nextType) return;
    closeList();
    out.push(`<${nextType}>`);
    listType = nextType;
  };
  const closeCode = () => {
    out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
    codeLines = [];
    inCode = false;
  };
  for (const line of lines) {
    if (/^\s*```.*$/.test(line)) {
      if (inCode) closeCode();
      else {
        closeParagraph();
        closeList();
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      out.push(`<div class="md-heading md-h${heading[1].length}">${inlineMarkdown(heading[2])}</div>`);
      continue;
    }
    if (/^\s{0,3}---+\s*$/.test(line)) {
      closeParagraph();
      closeList();
      out.push("<hr>");
      continue;
    }
    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      closeParagraph();
      closeList();
      out.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }
    const unordered = line.match(/^\s{0,3}[-*]\s+(.+)$/);
    const ordered = line.match(/^\s{0,3}\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      closeParagraph();
      openList(unordered ? "ul" : "ol");
      out.push(`<li>${inlineMarkdown((unordered ?? ordered)![1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(inlineMarkdown(line));
  }
  if (inCode) closeCode();
  closeParagraph();
  closeList();
  return out.join("\n");
}
