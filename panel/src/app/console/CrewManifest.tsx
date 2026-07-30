/**
 * Crew manifest — board `.crew` (~L1628). Lit when a snapshot agent
 * wears that persona; dark otherwise. No actions in P2.
 */
import type { AgentView } from "@room/protocol";
import { Bay, Chassis, CrtFace, Led } from "@room/ui";
import { PERSONAS, personaAvatarSrc } from "../personas.js";

interface CrewManifestProps {
  agents: AgentView[];
}

function matchAgent(agents: AgentView[], personaName: string, avatar: string): AgentView | null {
  const lower = personaName.toLowerCase();
  const av = avatar.toLowerCase();
  for (const a of agents) {
    const ch = (a.character ?? "").toLowerCase();
    if (ch === av || ch === lower) return a;
    if (a.name.toLowerCase() === lower) return a;
  }
  return null;
}

function statusLabel(agent: AgentView | null): { led: "amber" | "red" | "green" | "dim"; text: string } {
  if (!agent) return { led: "dim", text: "NO SESSION" };
  switch (agent.state) {
    case "hand_raised":
      return { led: "red", text: "NEEDS YOU" };
    case "speaking":
      return { led: "amber", text: "SPEAKING" };
    case "working":
      return { led: "amber", text: "WORKING" };
    default:
      return { led: "green", text: "IDLE" };
  }
}

export function CrewManifest({ agents }: CrewManifestProps) {
  return (
    <Bay label="CREW MANIFEST" meta="PILOT ROSTER" className="console-side-bay">
      <div className="console-crew">
        {PERSONAS.map((p) => {
          const agent = matchAgent(agents, p.name, p.avatar);
          const lit = !!agent;
          const st = statusLabel(agent);
          const role = lit
            ? `PILOTING ${(agent!.label ?? agent!.name).toUpperCase()}`
            : "NO CRAFT OUT";
          return (
            <Chassis
              key={p.name}
              className={`console-crewplate${lit ? "" : " off"}`}
              glow={lit ? "0 0 10px rgba(255,179,71,.2)" : "none"}
            >
              <CrtFace size={52} className="console-crew-face" scanlines={false} halo={lit && agent?.state === "speaking"}>
                <img src={personaAvatarSrc(p)} alt="" />
              </CrtFace>
              <div className="console-cname">{p.label.toUpperCase()}</div>
              <div className="console-crole">{role}</div>
              <div className="console-cstat">
                <Led tone={st.led} pulse={st.led === "amber" || st.led === "red"} />
                {st.text}
              </div>
            </Chassis>
          );
        })}
      </div>
    </Bay>
  );
}
