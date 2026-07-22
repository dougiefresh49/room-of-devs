/**
 * Avatar <img> + fallback pair. React renders the element; the stage
 * engine owns its src from the moment the ref registers (direct mutation —
 * frame flips never re-render React).
 *
 * Keyed by sessionId:character: a character swap remounts the img, which
 * resets any onerror-hidden state (Sol #12).
 */
import { useCallback } from "react";
import { initials } from "@room/ui";
import { registerAvatar } from "../stage/engine.js";
import type { AgentView } from "@room/protocol";

interface AvatarImgProps {
  agent: AgentView;
  imgClassName: string;
  fallbackClassName: string;
}

export function AvatarImg({ agent, imgClassName, fallbackClassName }: AvatarImgProps) {
  const character = (agent.character ?? "default").toLowerCase();
  const sessionId = agent.sessionId;

  const ref = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el) return;
      return registerAvatar(sessionId, character, el);
    },
    [sessionId, character],
  );

  return (
    <>
      {/* No src prop: the engine sets the first frame synchronously inside
          the ref callback (commit phase, before paint) and owns it after —
          a React-owned src would fight the engine on state-change renders. */}
      <img
        key={`${sessionId}:${character}`}
        ref={ref}
        className={imgClassName}
        alt=""
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
          const fallback = img.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.style.display === "none") {
            img.style.display = "";
            const fallback = img.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "";
          }
        }}
      />
      <span className={fallbackClassName}>{initials(agent.name)}</span>
    </>
  );
}
