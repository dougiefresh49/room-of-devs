import { useEffect, useState } from "react";
import { TRIGGERS } from "../mock/scenario";

export function ControlDeck() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button type="button" className="deck-fab" onClick={() => setOpen((v) => !v)}>
        {open ? "CLOSE DECK" : "CONTROL DECK `"}
      </button>
      {open ? (
        <div className="deck-drawer" role="dialog" aria-label="Control deck">
          <h3>SCENARIO TRIGGERS</h3>
          {TRIGGERS.map((t) => (
            <button
              type="button"
              key={t.id}
              className={t.danger ? "danger" : undefined}
              onClick={() => t.run()}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
