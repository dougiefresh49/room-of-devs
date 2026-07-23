/**
 * Avatar <img> + initials fallback. Static frame (no lipsync — that arrives
 * with the chunk-D audio/stage layer). onError falls back to the default
 * character art, then to the initials chip if that 404s too.
 */
import { useState } from "react";
import { initials } from "@room/ui";
import type { AgentView } from "@room/protocol";
import { avatarDir, avatarSrc, type AvatarFrame } from "../avatar.js";

interface AvatarProps {
  agent: Pick<AgentView, "character" | "name">;
  frame?: AvatarFrame;
  className?: string;
}

export function Avatar({ agent, frame = "idle", className }: AvatarProps) {
  const dir = avatarDir(agent);
  const key = `${dir}:${frame}`;
  const [triedDefault, setTriedDefault] = useState(false);
  const [failed, setFailed] = useState(false);
  // Reset the onError-hidden state when the character/frame changes
  // (idiomatic derive-state-from-props reset — no flash, no effect).
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setTriedDefault(false);
    setFailed(false);
  }

  if (failed) {
    return (
      <span className={className} data-avatar-fallback>
        {initials(agent.name)}
      </span>
    );
  }

  return (
    <img
      key={key}
      className={className}
      src={avatarSrc(triedDefault ? "default" : dir, frame)}
      alt=""
      onError={() => {
        if (!triedDefault && dir !== "default") setTriedDefault(true);
        else setFailed(true);
      }}
    />
  );
}
