/**
 * OS media-card metadata (Android notification / lock screen) via the Media
 * Session API: track title = message summary, artist = agent/thread name,
 * artwork = the character's avatar scaled onto the room background. Artwork
 * is rendered at runtime on a canvas from the daemon-served avatar PNGs — no
 * per-character static assets; blob URLs are cached per character.
 */
import { avatarSrc } from "../avatar.js";

export interface MediaMeta {
  title: string;
  artist: string;
  character: string | null;
}

const ART_SIZE = 512;
/** Avatar occupies this fraction of the square; the rest is background. */
const AVATAR_FRACTION = 0.74;
const FALLBACK_BG = "#101b20";

const artCache = new Map<string, Promise<string | null>>();
/** Monotonic guard so a slow artwork render can't stamp a newer track. */
let metaSeq = 0;

function hasMediaSession(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

function renderArtwork(character: string): Promise<string | null> {
  const cached = artCache.get(character);
  if (cached) return cached;
  const p = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = ART_SIZE;
        canvas.height = ART_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || FALLBACK_BG;
        ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);
        const scale = (ART_SIZE * AVATAR_FRACTION) / Math.max(img.width, img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (ART_SIZE - w) / 2, (ART_SIZE - h) / 2, w, h);
        canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/png");
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = avatarSrc(character, "idle");
  });
  artCache.set(character, p);
  return p;
}

export function setMediaSession(meta: MediaMeta): void {
  if (!hasMediaSession()) return;
  const ms = navigator.mediaSession;
  const seq = ++metaSeq;
  ms.metadata = new MediaMetadata({ title: meta.title, artist: meta.artist });
  ms.playbackState = "playing";
  const character = (meta.character || "default").toLowerCase();
  void renderArtwork(character).then((url) => {
    if (!url || seq !== metaSeq) return; // a newer track owns the card now
    ms.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      artwork: [{ src: url, sizes: `${ART_SIZE}x${ART_SIZE}`, type: "image/png" }],
    });
  });
}

export function setMediaPlaybackState(state: "playing" | "paused"): void {
  if (!hasMediaSession()) return;
  navigator.mediaSession.playbackState = state;
}

export function clearMediaSession(): void {
  if (!hasMediaSession()) return;
  metaSeq++; // discard any in-flight artwork update
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = "none";
}
