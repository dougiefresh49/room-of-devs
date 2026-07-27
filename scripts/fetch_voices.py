#!/usr/bin/env python3
"""
fetch_voices.py — Fetch and cache the user's ElevenLabs voices.

Usage:
    python3 fetch_voices.py           # prints JSON list of voices
    python3 fetch_voices.py --refresh # force refresh cache

Cache: ~/.cursor/tts/cache/voices.json (refreshes every 10 minutes)
"""

import json
import os
import subprocess
import sys
import time

# Q-14: honor exported TTS_DIR (same default as scripts/lib/tts-dir.sh).
TTS_DIR = os.environ.get("TTS_DIR") or os.path.expanduser("~/.cursor/tts")
CACHE_DIR = os.path.join(TTS_DIR, "cache")
CACHE_FILE = os.path.join(CACHE_DIR, "voices.json")
LOG_PATH = os.path.join(TTS_DIR, "logs", "hook.log")
CACHE_TTL = 600  # 10 minutes


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            from datetime import datetime
            ts = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
            f.write(f"{ts} fetch_voices: {msg}\n")
    except OSError:
        pass


def load_env():
    """Load only the ElevenLabs key from .env (H-3 allowlist parity)."""
    if os.environ.get("ELEVENLABS_API_KEY"):
        return
    allow = {"ELEVENLABS_API_KEY"}
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
                            if key in allow and key not in os.environ:
                                os.environ[key] = value
            except OSError:
                pass
            break


def fetch_from_api(api_key):
    """Fetch voices from ElevenLabs API v2 using curl (avoids Python SSL issues on macOS)."""
    try:
        # H-5: pass the key via curl --config stdin, never as -H argv.
        curl_config = f'header = "xi-api-key: {api_key}"\n'
        r = subprocess.run(
            [
                "curl", "-s", "-f", "-K", "-",
                "https://api.elevenlabs.io/v2/voices?page_size=100",
            ],
            input=curl_config,
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode != 0:
            log(f"curl failed (exit {r.returncode}): {r.stderr.strip()[:200]}")
            return None

        data = json.loads(r.stdout)
    except subprocess.TimeoutExpired:
        log("API timeout")
        return None
    except (json.JSONDecodeError, Exception) as e:
        log(f"API error: {e}")
        return None

    voices = []
    for v in data.get("voices", []):
        voice = {
            "voice_id": v.get("voice_id", ""),
            "name": v.get("name", "Unknown"),
            "category": v.get("category", ""),
            "labels": v.get("labels", {}),
        }
        if voice["voice_id"]:
            voices.append(voice)

    log(f"Fetched {len(voices)} voices from API")
    return voices


def get_cached():
    """Return cached voices if still fresh."""
    if not os.path.isfile(CACHE_FILE):
        return None
    try:
        mtime = os.path.getmtime(CACHE_FILE)
        if time.time() - mtime > CACHE_TTL:
            return None
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save_cache(voices):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(voices, f, indent=2)


def main():
    force_refresh = "--refresh" in sys.argv

    load_env()
    api_key = os.environ.get("ELEVENLABS_API_KEY", "")

    if not api_key:
        log("No ELEVENLABS_API_KEY")
        print("[]")
        return

    if not force_refresh:
        cached = get_cached()
        if cached is not None:
            print(json.dumps(cached))
            return

    voices = fetch_from_api(api_key)
    if voices is None:
        cached = get_cached()
        if cached is not None:
            log("Using stale cache after API failure")
            print(json.dumps(cached))
        else:
            print("[]")
        return

    save_cache(voices)
    print(json.dumps(voices))


if __name__ == "__main__":
    main()
