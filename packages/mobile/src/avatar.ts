/**
 * Avatar asset URLs — same paths mobile.html serves from the daemon
 * (/avatars/tmnt/<character>/<frame>.png). Frame is a static pose here;
 * lipsync/blink frame flipping is a chunk-D concern (the audio/stage layer).
 */
import type { AgentView } from "@room/protocol";

export type AvatarFrame = "idle" | "speaking" | "blink";

export function avatarSrc(character: string, frame: AvatarFrame = "idle"): string {
  return `/avatars/tmnt/${encodeURIComponent(character)}/${frame}.png`;
}

/** The character folder for an agent's avatar; "default" when unassigned. */
export function avatarDir(agent: Pick<AgentView, "character">): string {
  return agent.character ? agent.character.toLowerCase() : "default";
}
