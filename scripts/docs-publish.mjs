#!/usr/bin/env node
// Render docs/STATUS.md + docs/active/*.md into one self-contained HTML
// page and upload it to Postplan (phone-viewable dashboard).
//
//   pnpm docs:publish            # render + upload (updates the same draft)
//   pnpm docs:publish --dry-run  # render only, print output path
//
// The Postplan draft id is stored in docs/.postplan-draft after the first
// upload so the URL stays stable.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const docsDir = join(repo, "docs");
const draftIdFile = join(docsDir, ".postplan-draft");
const dryRun = process.argv.includes("--dry-run");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ```mermaid fences → inline SVG, rendered at build time (Postplan rejects
// ALL JavaScript, so client-side mermaid is not an option). Rendered SVGs are
// cached by content hash — only new/changed diagrams shell out to mermaid-cli.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const mermaidCacheDir = join(docsDir, ".build", "mermaid");
function renderMermaid(src) {
  mkdirSync(mermaidCacheDir, { recursive: true });
  const hash = createHash("sha1").update(src).digest("hex").slice(0, 12);
  const svgFile = join(mermaidCacheDir, `${hash}.svg`);
  if (!existsSync(svgFile)) {
    const mmdFile = join(mermaidCacheDir, `${hash}.mmd`);
    const pptrFile = join(mermaidCacheDir, "pptr.json");
    writeFileSync(mmdFile, src);
    writeFileSync(
      pptrFile,
      JSON.stringify({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] }),
    );
    execFileSync(
      "pnpm",
      ["dlx", "@mermaid-js/mermaid-cli@11", "-p", pptrFile, "-i", mmdFile, "-o", svgFile,
       "-b", "transparent", "-t", "neutral", "-I", `m${hash}`],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    // Postplan caps pages at 512KB; minified SVGs buy real headroom.
    execFileSync("pnpm", ["dlx", "svgo", "--multipass", "-q", svgFile], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  return `<figure class="mermaid">${readFileSync(svgFile, "utf8")}</figure>\n`;
}

marked.use({
  renderer: {
    code({ text, lang }) {
      if ((lang ?? "").trim() === "mermaid") {
        try {
          return renderMermaid(text);
        } catch (err) {
          console.warn(`mermaid render failed (${err.message}) — emitting source block`);
          return `<pre><code>${esc(text)}</code></pre>\n`;
        }
      }
      return false;
    },
  },
});

function section(title, mdPath, open = false) {
  const md = readFileSync(mdPath, "utf8");
  const slug = basename(mdPath, ".md");
  return `<details class="doc" id="${esc(slug)}" ${title === "STATUS" || open ? "open" : ""}>
<summary>${esc(title)}</summary>
<article>${marked.parse(md)}</article>
</details>`;
}

// Root-level active docs that deserve their OWN Postplan draft instead of a
// collapsed <details> on the main page. On the main page only STATUS opens by
// default, so a long doc buried there is invisible in practice — which is
// exactly what happened to the locked design target.
const OWN_PAGE = new Set(["design-ui-target.md"]);

// docs/active/*.md on the main page; each active/ subfolder (e.g.
// architecture-concepts/) becomes its OWN Postplan draft — Postplan caps a
// page at 512KB and diagram-heavy folders blow that fast.
function listActive() {
  const activeDir = join(docsDir, "active");
  const top = [];
  const subs = [];
  if (!existsSync(activeDir)) return { top, subs };
  for (const entry of readdirSync(activeDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const title = entry.name.replace(/\.md$/, "");
      if (OWN_PAGE.has(entry.name)) {
        subs.push({ name: title, docs: [{ title, path: join(activeDir, entry.name) }] });
      } else {
        top.push({ title, path: join(activeDir, entry.name) });
      }
    } else if (entry.isDirectory()) {
      const docs = readdirSync(join(activeDir, entry.name))
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => ({
          title: f.replace(/\.md$/, ""),
          path: join(activeDir, entry.name, f),
        }));
      if (docs.length) subs.push({ name: entry.name, docs });
    }
  }
  return { top, subs };
}

const { top: activeDocs, subs: subPages } = listActive();

const updated = new Date().toISOString().slice(0, 16).replace("T", " ");

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0 auto; max-width: 46rem; padding: 1rem 1.1rem 4rem;
         font: 16px/1.55 -apple-system, system-ui, sans-serif; }
  h1 { font-size: 1.35rem; } h2 { font-size: 1.15rem; margin-top: 1.6em; }
  h3 { font-size: 1rem; }
  details.doc { border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
                border-radius: 10px; margin: .8rem 0; padding: 0 .9rem; }
  details.doc > summary { cursor: pointer; font-weight: 650; padding: .7rem 0;
                          list-style-position: outside; }
  details.doc[open] > summary { border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  article { padding: .3rem 0 1rem; overflow-wrap: anywhere; }
  pre { overflow-x: auto; padding: .6rem .8rem; border-radius: 8px;
        background: color-mix(in srgb, currentColor 8%, transparent); font-size: .85em; }
  code { font-size: .9em; }
  table { border-collapse: collapse; display: block; overflow-x: auto; }
  th, td { border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
           padding: .3rem .55rem; text-align: left; overflow-wrap: normal; }
  th:first-child, td:first-child { white-space: nowrap; }
  a { color: #4a8df0; }
  .meta { opacity: .6; font-size: .8rem; margin: .2rem 0 1rem; }
  figure.mermaid { background: #fff; border-radius: 10px; padding: .6rem;
                   margin: 1rem 0; overflow-x: auto; }
  figure.mermaid svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }`;

function pageHtml(title, heading, subtitle, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${PAGE_CSS}
</style>
</head>
<body>
<h1>${heading}</h1>
<p class="meta">${esc(subtitle)}</p>
${body}
</body>
</html>`;
}

// Render inside the repo (gitignored): postplan reads git metadata from the
// uploaded file's directory, which groups the draft under this repo.
const buildDir = join(docsDir, ".build");
mkdirSync(buildDir, { recursive: true });

// Upload a page, keeping its draft id (→ stable URL) in draftFile. Returns
// the page URL, or null on dry-run / when the URL can't be determined yet.
function uploadPage(outFile, draftFile, description) {
  const kb = Math.round(readFileSync(outFile).length / 1024);
  console.log(`rendered: ${outFile} (${kb}KB)`);
  const existingId = existsSync(draftFile) ? readFileSync(draftFile, "utf8").trim() : null;
  if (dryRun) return existingId ? `https://${existingId}.postplan.dev` : null;
  const args = ["upload", outFile, "--description", description];
  args.push(...(existingId ? ["--draft", existingId] : ["--new"]));
  const out = execFileSync("postplan", args, { encoding: "utf8" });
  process.stdout.write(out);
  const m =
    out.match(/draft\s*id[:\s]+([A-Za-z0-9_-]{6,})/i) ?? out.match(/\/d\/([A-Za-z0-9_-]{6,})\//);
  const id = existingId ?? m?.[1];
  if (!existingId) {
    if (id) {
      writeFileSync(draftFile, id + "\n");
      console.log(`saved draft id → ${basename(draftFile)} (${id})`);
    } else {
      console.warn(`could not parse draft id — save it to ${basename(draftFile)} manually`);
    }
  }
  return id ? `https://${id}.postplan.dev` : null;
}

// Sub-pages first so the main page can link to them.
const subLinks = [];
for (const sub of subPages) {
  // A one-doc page is that doc — don't make the reader expand an accordion of one.
  const solo = sub.docs.length === 1;
  const body = sub.docs
    .map((d) => section(solo ? d.title : `${sub.name}/${d.title}`, d.path, solo))
    .join("\n");
  const outFile = join(buildDir, `room-${sub.name}.html`);
  writeFileSync(
    outFile,
    pageHtml(
      `Room of Devs — ${sub.name}`,
      `🐢 ${esc(sub.name)}`,
      `Published ${updated} UTC · ${sub.docs.length} doc(s)`,
      body,
    ),
  );
  const url = uploadPage(
    outFile,
    join(docsDir, `.postplan-draft-${sub.name}`),
    `Room of Devs — ${sub.name}`,
  );
  subLinks.push({ name: sub.name, count: sub.docs.length, url });
}

const linkList = subLinks.length
  ? `<h2>Doc collections</h2>\n<ul>${subLinks
      .map(
        (s) =>
          `<li>${s.url ? `<a href="${s.url}">${esc(s.name)}</a>` : esc(s.name)} (${s.count} docs)</li>`,
      )
      .join("")}</ul>`
  : "";

const mainBody = [
  section("STATUS", join(docsDir, "STATUS.md")),
  linkList,
  ...activeDocs.map((d) => section(d.title, d.path)),
].join("\n");

const mainFile = join(buildDir, "room-status.html");
writeFileSync(
  mainFile,
  pageHtml(
    "Room of Devs — Status",
    "🐢 Room of Devs",
    `Published ${updated} UTC · STATUS + ${activeDocs.length} active doc(s)`,
    mainBody,
  ),
);
uploadPage(mainFile, draftIdFile, "Room of Devs — status + active docs");
