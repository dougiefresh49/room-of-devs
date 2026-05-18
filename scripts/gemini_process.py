#!/usr/bin/env python3
"""
gemini_process.py — Use Gemini to convert raw markdown into natural speech
with ElevenLabs v3 audio tags for human-like TTS delivery.

Falls back to local clean_text.py if Gemini is unavailable.

Usage:
    echo "markdown text" | python3 gemini_process.py
    echo "markdown text" | GEMINI_API_KEY=... python3 gemini_process.py

Reads config from ~/.cursor/tts/config.json for model selection.
"""

import json
import os
import re
import subprocess
import sys

TTS_DIR = os.path.expanduser("~/.cursor/tts")
CONFIG_PATH = os.path.join(TTS_DIR, "config.json")
LOG_PATH = os.path.join(TTS_DIR, "logs", "hook.log")

SYSTEM_PROMPT = """You convert AI agent markdown responses into natural spoken text for ElevenLabs v3 TTS.

You are preparing text that will be read aloud to a developer who just got a response from their AI coding assistant. Read it like a dev friend summarizing what the agent did, not like a robot reading documentation.

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

Output ONLY the processed speech text. No explanations, no quotes, no surrounding markdown."""


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            from datetime import datetime
            ts = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
            f.write(f"{ts} gemini_process: {msg}\n")
    except OSError:
        pass


def load_env():
    """Load .env file if API key not already set."""
    if os.environ.get("GEMINI_API_KEY"):
        return
    for env_path in [
        os.path.join(TTS_DIR, ".env"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
    ]:
        if os.path.isfile(env_path):
            try:
                with open(env_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            key, _, value = line.partition("=")
                            key = key.strip()
                            value = value.strip().strip("\"'")
                            if key and key not in os.environ:
                                os.environ[key] = value
            except OSError:
                pass
            break


def call_gemini(text, api_key, model="gemini-3.1-flash-lite", timeout=15):
    """Call Gemini API to process text for TTS using curl (avoids Python SSL issues on macOS)."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    payload = json.dumps({
        "systemInstruction": {
            "parts": [{"text": SYSTEM_PROMPT}]
        },
        "contents": [
            {"parts": [{"text": text}]}
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 4096,
        }
    })

    try:
        r = subprocess.run(
            [
                "curl", "-s", "-f",
                "--max-time", str(timeout),
                "-X", "POST",
                "-H", "Content-Type: application/json",
                "-d", payload,
                url,
            ],
            capture_output=True, text=True, timeout=timeout,
        )
        if r.returncode != 0:
            log(f"Gemini curl failed (exit {r.returncode}): {r.stderr.strip()[:200]}")
            return None

        data = json.loads(r.stdout)

        candidates = data.get("candidates", [])
        if not candidates:
            log("Gemini returned no candidates")
            return None

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            log("Gemini returned no parts")
            return None

        result = parts[0].get("text", "").strip()
        if not result:
            log("Gemini returned empty text")
            return None

        log(f"Gemini processed: {len(text)} chars → {len(result)} chars")
        return result

    except subprocess.TimeoutExpired:
        log("Gemini timeout")
        return None
    except Exception as e:
        log(f"Gemini error: {e}")
        return None


def fallback_clean(text):
    """Use the local clean_text.py as fallback."""
    scripts_dir = os.path.join(TTS_DIR, "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    try:
        # Also check the repo scripts dir
        repo_scripts = os.path.dirname(os.path.abspath(__file__))
        if repo_scripts not in sys.path:
            sys.path.insert(0, repo_scripts)
        from clean_text import clean
        return clean(text)
    except ImportError:
        log("fallback: clean_text.py not found, returning stripped text")
        text = re.sub(r"```[\s\S]*?```", "", text)
        text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
        text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
        text = re.sub(r"`([^`]+)`", r"\1", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        sys.exit(0)

    load_env()
    config = load_config()
    api_key = os.environ.get("GEMINI_API_KEY", "")
    model = config.get("gemini_model", "gemini-3.1-flash-lite")

    result = None
    if api_key:
        result = call_gemini(raw, api_key, model)

    if not result:
        if not api_key:
            log("No GEMINI_API_KEY — using local fallback")
        result = fallback_clean(raw)

    if not result or not result.strip():
        print("No speakable text found.", file=sys.stderr)
        sys.exit(0)

    duration = len(result) / 15.0
    print(f"Estimated duration: {duration:.0f}s (~{duration/60:.1f} min)", file=sys.stderr)
    print(result)


if __name__ == "__main__":
    main()
