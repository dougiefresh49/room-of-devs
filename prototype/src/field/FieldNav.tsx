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
            <span className="dot red" aria-hidden />
          ) : null}
          {t.id === "listen" && listenBadge ? (
            <span className="dot amber" aria-hidden />
          ) : null}
        </button>
      ))}
    </nav>
  );
}
