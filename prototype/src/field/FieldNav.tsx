import { Led } from "@room/ui/rig";

export type FieldScreen = "glance" | "answer" | "listen" | "start" | "gauges";

const TABS: { id: FieldScreen; label: string }[] = [
  { id: "glance", label: "GLANCE" },
  { id: "answer", label: "ANSWER" },
  { id: "listen", label: "LISTEN" },
  { id: "start", label: "START" },
  { id: "gauges", label: "GAUGES" },
];

export interface FieldNavProps {
  screen: FieldScreen;
  onChange: (s: FieldScreen) => void;
  answerBadge: boolean;
  listenBadge: boolean;
}

export function FieldNav({
  screen,
  onChange,
  answerBadge,
  listenBadge,
}: FieldNavProps) {
  return (
    <nav className="fnav" aria-label="Field screens">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={screen === t.id ? "active" : undefined}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.id === "answer" && answerBadge ? (
            <Led tone="red" className="fnav-dot" />
          ) : null}
          {t.id === "listen" && listenBadge ? (
            <Led tone="amber" className="fnav-dot" />
          ) : null}
        </button>
      ))}
    </nav>
  );
}
