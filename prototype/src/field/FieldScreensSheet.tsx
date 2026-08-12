import { Sheet, SheetContent, SheetTitle } from "@room/ui";
import { Led } from "@room/ui/rig";
import { Gauge, MessageSquare, PenLine, Radar, ToggleRight } from "lucide-react";
import { useRoom } from "../mock/store";
import type { FieldBadge, FieldScreen } from "./types";

const TABS = [
  { id: "glance", label: "GLANCE", Icon: Radar },
  { id: "coms", label: "COMS", Icon: MessageSquare },
  { id: "orders", label: "ORDERS", Icon: ToggleRight },
  { id: "gauges", label: "GAUGES", Icon: Gauge },
] satisfies { id: FieldScreen; label: string; Icon: typeof Radar }[];

/** Screens chooser — the top-bar title's bottom sheet (nav lives here now). */
export function FieldScreensSheet({
  open,
  onOpenChange,
  screen,
  badges,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screen: FieldScreen;
  badges: Partial<Record<FieldScreen, FieldBadge>>;
  onSelect: (screen: FieldScreen) => void;
}) {
  const room = useRoom();
  const hasDraft = room.composerText.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showClose={false}
        className="screenbed field-bounds-sheet field-screenssheet field-sheet-open"
        overlayClassName="field-sheet-overlay"
      >
        <button
          type="button"
          className="nodesheet-pull"
          aria-label="Close screens menu"
          onClick={() => onOpenChange(false)}
        >
          <span aria-hidden />
        </button>
        <SheetTitle className="visually-hidden">Screens</SheetTitle>
        {TABS.map(({ id, label, Icon }) => {
          const badge = badges[id];
          return (
            <button
              type="button"
              key={id}
              className={screen === id ? "is-active" : undefined}
              aria-current={screen === id ? "page" : undefined}
              onClick={() => {
                onOpenChange(false);
                onSelect(id);
              }}
            >
              <Icon size={16} aria-hidden />
              <span className="fss-name">{label}</span>
              {id === "coms" && hasDraft ? (
                <span className="fss-draft">
                  <PenLine size={12} aria-hidden />
                  DRAFT
                </span>
              ) : null}
              {id === "coms" && room.micHot ? (
                <>
                  <Led tone="red" className="fss-michot" />
                  <span className="visually-hidden">Mac mic hot</span>
                </>
              ) : null}
              {badge ? (
                <>
                  <Led tone={badge.tone} pulse={badge.pulse} />
                  <span className="visually-hidden">{badge.label}</span>
                </>
              ) : null}
              <em aria-hidden>▸</em>
            </button>
          );
        })}
      </SheetContent>
    </Sheet>
  );
}
