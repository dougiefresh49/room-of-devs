import { Led } from "@room/ui/rig";
import type { ReactNode } from "react";

export type FieldScreen = "glance" | "coms" | "orders" | "gauges";

export interface FieldBadge {
  tone: "red" | "amber";
  pulse?: boolean;
  label: string;
}

const TABS: { id: FieldScreen; label: string }[] = [
  { id: "glance", label: "GLANCE" },
  { id: "coms", label: "COMS" },
  { id: "orders", label: "ORDERS" },
  { id: "gauges", label: "GAUGES" },
];

export interface FieldNavProps {
  screen: FieldScreen;
  onChange: (s: FieldScreen) => void;
  badges: Partial<Record<FieldScreen, FieldBadge>>;
  onBadgePress?: (screen: FieldScreen, badge: FieldBadge) => void;
  leading?: ReactNode;
}

export function FieldNav({ screen, onChange, badges, onBadgePress, leading }: FieldNavProps) {
  return (
    <div className="fnav-row">
      {leading ? (
        <>
          <div className="fnav-leading">{leading}</div>
          <span className="fnav-divider" aria-hidden />
        </>
      ) : null}
      <nav className="fnav" aria-label="Field screens">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={screen === t.id ? "active" : undefined}
            onClick={() => {
              const badge = badges[t.id];
              onChange(t.id);
              if (badge) onBadgePress?.(t.id, badge);
            }}
          >
            <span className="fnav-label">
              {t.label}
              {badges[t.id] ? (
                <Led
                  tone={badges[t.id]?.tone}
                  pulse={badges[t.id]?.pulse}
                  className="fnav-dot"
                  aria-hidden
                />
              ) : null}
            </span>
            {badges[t.id] ? <span className="sr-only">{badges[t.id]?.label}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
