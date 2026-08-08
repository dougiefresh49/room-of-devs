import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@room/ui";
import { useEffect, useState } from "react";
import { TRIGGERS } from "../mock/scenario";

export function ControlDeck() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("deck") === "1";
    document.documentElement.classList.toggle("deck-forced", forced);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "`") return;
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      const target = event.target as HTMLElement | null;
      const editable = Boolean(
        target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable),
      );
      if (editable && !modified) return;
      if (modified) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    const onFieldOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("field:open-deck", onFieldOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("field:open-deck", onFieldOpen);
      document.documentElement.classList.remove("deck-forced");
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="deck-fab">
          {open ? "CLOSE DECK" : "CONTROL DECK `"}
        </button>
      </DialogTrigger>
      <DialogContent className="rig-command-dialog deck-drawer">
        <DialogTitle className="visually-hidden">Scenario triggers</DialogTitle>
        <div className="deck-touch-hint">LONG-PRESS THE ROOM CHIP ON TOUCH</div>
        <Command aria-label="Scenario triggers">
          <CommandInput
            autoFocus
            placeholder="FILTER SCENARIO TRIGGERS…"
            aria-label="Filter scenario triggers"
          />
          <CommandList>
            <CommandEmpty>NO TRIGGER MATCHES</CommandEmpty>
            <CommandGroup heading="SCENARIO TRIGGERS">
              {TRIGGERS.map((trigger) => (
                <CommandItem
                  key={trigger.id}
                  value={`${trigger.label} ${trigger.id}`}
                  className={trigger.danger ? "danger" : undefined}
                  onSelect={() => {
                    trigger.run();
                    setOpen(false);
                  }}
                >
                  {trigger.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
