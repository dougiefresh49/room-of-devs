import { useEffect, useRef } from "react";
import type { PersonaId } from "../mock/types";

/** Map persona → tmnt folder name. */
export const PERSONA_FOLDER: Record<PersonaId, string> = {
  mikey: "michelangelo",
  donnie: "donatello",
  leo: "leonardo",
  raph: "raphael",
  splinter: "splinter",
  shredder: "shredder",
  karai: "karai",
};

const FRAME_MODULES = import.meta.glob(
  "../avatars/tmnt/*/{idle,speaking,blink,mouth-mid,stoked-speaking,stoked-mouth-closed}.png",
  { eager: true, import: "default" },
) as Record<string, string>;

function frameUrl(folder: string, name: string): string | null {
  const key = Object.keys(FRAME_MODULES).find(
    (k) => k.includes(`/tmnt/${folder}/`) && k.endsWith(`/${name}.png`),
  );
  return key ? FRAME_MODULES[key]! : null;
}

export type FaceMode = "idle" | "speaking" | "stoked";

export interface AvatarFaceProps {
  persona: PersonaId;
  mode?: FaceMode;
  size?: number;
  className?: string;
}

/**
 * Lipsync/blink via rAF + img.src mutation — never React re-render for frames.
 */
export function AvatarFace({
  persona,
  mode = "idle",
  size = 176,
  className,
}: AvatarFaceProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const folder = PERSONA_FOLDER[persona];
  const idle = frameUrl(folder, "idle");
  const speaking = frameUrl(folder, "speaking");
  const mouthMid = frameUrl(folder, "mouth-mid");
  const blink = frameUrl(folder, "blink");
  const stoked =
    frameUrl(folder, "stoked-speaking") ??
    frameUrl(folder, "stoked-mouth-closed") ??
    idle;

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !idle) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      img.src = mode === "stoked" ? (stoked ?? idle) : idle;
      return;
    }

    let raf = 0;
    let alive = true;
    const blinkPeriod = 5200 + (persona.charCodeAt(0) % 7) * 380;
    let nextBlink = performance.now() + blinkPeriod;
    let blinkUntil = 0;
    let lipPhase = 0;

    const tick = (now: number) => {
      if (!alive || !img) return;
      if (mode === "stoked" && stoked) {
        img.src = stoked;
      } else if (mode === "speaking") {
        lipPhase = (lipPhase + 1) % 12;
        const src =
          lipPhase < 3
            ? mouthMid ?? speaking ?? idle
            : lipPhase < 7
              ? speaking ?? idle
              : lipPhase < 10
                ? mouthMid ?? idle
                : idle;
        img.src = src;
      } else {
        if (now >= nextBlink) {
          blinkUntil = now + 120;
          nextBlink = now + blinkPeriod;
        }
        if (now < blinkUntil && blink) img.src = blink;
        else img.src = idle;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [persona, mode, idle, speaking, mouthMid, blink, stoked]);

  return (
    <img
      ref={imgRef}
      alt=""
      width={size}
      height={size}
      className={className}
      src={idle ?? undefined}
      draggable={false}
      style={{ width: size, height: size, display: "block", objectFit: "contain" }}
    />
  );
}
