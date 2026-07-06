import { GoogleGenAI } from "@google/genai";
import { log } from "./logger.js";

const BASE_SYSTEM_PROMPT = `You convert AI agent markdown responses into natural spoken text for ElevenLabs v3 TTS.

Rules:
1. REMOVE all code blocks, shell commands, import statements, and raw code. Never read code aloud.
2. REMOVE file paths and convert them to natural references. Instead of "src/components/Button.tsx", say "the Button component". Instead of "package.json", say "the package dot json".
3. REMOVE markdown formatting (headers, bullets, bold, links, images, tables).
4. CONVERT technical jargon into conversational speech. "Refactored the useAuth hook" → "I refactored the use auth hook".
5. ADD ElevenLabs v3 audio tags where natural:
   - [sighs] before delivering bad news or acknowledging difficulty
   - [excited] or [enthusiastic] for positive completions
   - Use CAPS for emphasis on key words: "This is REALLY important"
   - Use ellipses (...) for natural pauses and thinking moments
   - [whispers] for asides or caveats
   - [laughs] only if genuinely funny or self-deprecating
6. Keep the MEANING exactly — do not add information or change what was communicated.
7. Abbreviations: spell out uncommon ones, keep common ones (API, CSS, HTML, JSON, URL, SQL, CLI, npm, git).
8. Numbers: spell out small numbers (one through twelve), use words for large round numbers ("about two hundred").
9. Punctuation: use periods and commas for natural speech rhythm. Use question marks for rhetorical questions.
10. Keep it concise. If the original is very long, summarize the key points naturally. Aim for under 4000 characters.
11. Start directly with the content — no "Here's what happened" or "So basically" preamble.
12. For lists of changes/files, summarize the theme rather than reading each item: "I updated several components" not a list of every file.

Output ONLY the processed speech text. No explanations, no quotes, no surrounding markdown.`;

export interface CharacterContext {
  name: string;
  personality: string;
  speechStyle: string;
}

function buildSystemPrompt(character?: CharacterContext | null): string {
  if (!character) {
    return BASE_SYSTEM_PROMPT + `\n\nRead it like a dev friend summarizing what the agent did.`;
  }

  return BASE_SYSTEM_PROMPT + `\n\nYou are rewriting this as ${character.name}. Stay in character throughout.

Personality: ${character.personality}
Speech style: ${character.speechStyle}

Rewrite the agent's response as if ${character.name} is the one reporting back to the developer. Use ${character.name}'s vocabulary, tone, and mannerisms naturally. Do NOT add catchphrases on every line — use them sparingly. The character should sound natural, not like a parody.`;
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  if (client) return client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  client = new GoogleGenAI({ apiKey: key });
  return client;
}

export async function processWithGemini(
  text: string,
  model = "gemini-3.1-flash-lite",
  character?: CharacterContext | null
): Promise<string | null> {
  const ai = getClient();
  if (!ai) {
    log("gemini", "No GEMINI_API_KEY — skipping");
    return null;
  }

  try {
    const systemPrompt = buildSystemPrompt(character);
    const response = await ai.models.generateContent({
      model,
      contents: text,
      config: {
        systemInstruction: systemPrompt,
        temperature: character ? 0.5 : 0.3,
        maxOutputTokens: 4096,
      },
    });

    const result = response.text?.trim();
    if (!result) {
      log("gemini", "Empty response");
      return null;
    }

    log("gemini", `Processed: ${text.length} chars → ${result.length} chars`);
    return result;
  } catch (err: any) {
    log("gemini", `Error: ${err.message || err}`);
    return null;
  }
}

// --- Fallback cleaner (used when Gemini fails) ---------------------------
// TypeScript port of scripts/clean_text.py `clean()`: tables → prose,
// code-line stripping, path/identifier humanization, so a Gemini hiccup
// doesn't send raw markdown (paths, table pipes) to ElevenLabs.

const EXT_SPEECH: Record<string, string> = {
  ".ts": " T S", ".tsx": " T S X", ".js": " J S", ".jsx": " J S X",
  ".py": " python", ".json": " JSON", ".md": " markdown",
  ".html": " H T M L", ".css": " C S S", ".sh": " shell",
  ".sql": " S Q L", ".yml": " YAML", ".yaml": " YAML",
  ".env": " env", ".txt": " text", ".csv": " C S V",
  ".pdf": " P D F", ".png": " P N G", ".jpg": " J P G",
  ".svg": " S V G", ".xml": " X M L", ".rs": " rust",
  ".go": " go", ".rb": " ruby", ".onnx": " O N N X",
};

function humanizeIdentifier(name: string, withExt = true): string {
  let extSpoken = "";
  if (withExt) {
    for (const [ext, speech] of Object.entries(EXT_SPEECH)) {
      if (name.endsWith(ext)) {
        name = name.slice(0, -ext.length);
        extSpoken = speech;
        break;
      }
    }
  }
  // camelCase / PascalCase boundaries
  name = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  name = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  name = name.replace(/[-_]/g, " ");
  name = name.replace(/\s+/g, " ").trim();
  return name + extSpoken;
}

function humanizeCodeToken(token: string): string {
  token = token.trim();
  if (!token) return token;

  token = token.replace(/\(\)$/, "");

  if (token.includes("/")) {
    return token
      .split("/")
      .filter(Boolean)
      .map((p) => humanizeIdentifier(p))
      .join(" ");
  }

  const hasExt = Object.keys(EXT_SPEECH).some((ext) => token.endsWith(ext));
  if (token.includes(".") && !hasExt) {
    return token
      .split(".")
      .map((p) => humanizeIdentifier(p, false))
      .join(" ");
  }

  return humanizeIdentifier(token);
}

function convertTablesToProse(text: string): string {
  return text.replace(/(?:^\|.+\|[ \t]*\n){2,}/gm, (block) => {
    const rows = block
      .trim()
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    if (rows.length < 2) return block;

    const parseRow = (row: string): string[] => {
      let cells = row.split("|");
      if (cells.length && cells[0].trim() === "") cells = cells.slice(1);
      if (cells.length && cells[cells.length - 1].trim() === "")
        cells = cells.slice(0, -1);
      return cells.map((c) => c.trim());
    };

    const headers = parseRow(rows[0]);
    const separatorRe = /^[\s|:-]+$/;
    const dataRows = rows
      .slice(1)
      .filter((r) => !separatorRe.test(r))
      .map(parseRow);
    if (dataRows.length === 0) return block;

    const lines: string[] = [];
    for (const cells of dataRows) {
      const parts: string[] = [];
      cells.forEach((cell, i) => {
        if (!cell || cell.replace(/-/g, "").trim() === "") return;
        if (i < headers.length && headers[i]) {
          parts.push(`${headers[i]}: ${cell}`);
        } else {
          parts.push(cell);
        }
      });
      if (parts.length) lines.push(parts.join("; ") + ".");
    }
    return lines.join("\n") + "\n";
  });
}

const CODE_PREFIXES = [
  "import ", "from ", "const ", "let ", "var ", "function ", "class ",
  "export ", "SELECT ", "INSERT ", "UPDATE ", "DELETE ", "CREATE ",
  "curl ", "wget ", "npm ", "pip ", "yarn ", "docker ", "kubectl ",
  "git ", "cd ", "mkdir ", "cp ", "mv ", "rm ", "chmod ", "brew ",
  "sudo ", "echo ", "cat ", "#!/", "//", "/*",
];

const SYMBOL_CHARS = new Set("{}();=><[]|&^~\\@#$%");

function removeCodeLikeLines(text: string): string {
  const result: string[] = [];
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (!stripped) {
      result.push("");
      continue;
    }
    if (CODE_PREFIXES.some((p) => stripped.startsWith(p))) continue;
    // High symbol density = likely code
    if (stripped.length > 10) {
      let symbolCount = 0;
      for (const c of stripped) if (SYMBOL_CHARS.has(c)) symbolCount++;
      if (symbolCount / stripped.length > 0.15) continue;
    }
    result.push(line);
  }
  return result.join("\n");
}

function humanizeRemainingPaths(text: string): string {
  const extPattern = Object.keys(EXT_SPEECH)
    .map((e) => e.replace(".", "\\."))
    .join("|");
  const pathRe = new RegExp(
    `(?<!\\w)(?:[a-zA-Z0-9_.@-]+/)+[a-zA-Z0-9_.-]+(?:${extPattern})`,
    "g"
  );
  text = text.replace(pathRe, (m) => humanizeCodeToken(m));

  const camelRe = /(?<!\w)[a-z]+(?:[A-Z][a-z]+){2,}(?:\(\))?(?!\w)/g;
  text = text.replace(camelRe, (m) => humanizeCodeToken(m));

  return text;
}

export function fallbackClean(text: string): string {
  let cleaned = text;
  // fenced code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = convertTablesToProse(cleaned);
  // images, links
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // headers → plain text with a period for a TTS pause
  cleaned = cleaned.replace(/^#{1,6}\s+(.+)$/gm, "$1.");
  // inline code → humanized token
  cleaned = cleaned.replace(/`([^`\n]+)`/g, (_, t) => humanizeCodeToken(t));
  cleaned = removeCodeLikeLines(cleaned);
  // bold / italic markers
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  cleaned = cleaned.replace(/__([^_]+)__/g, "$1");
  cleaned = cleaned.replace(/_([^_]+)_/g, "$1");
  // bullet / list markers
  cleaned = cleaned.replace(/^(\s*)-\s+/gm, "$1");
  cleaned = cleaned.replace(/^(\s*)\*\s+/gm, "$1");
  cleaned = cleaned.replace(/^(\s*)\d+\.\s+/gm, "$1");
  cleaned = humanizeRemainingPaths(cleaned);
  // collapse whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
  return cleaned.trim();
}
