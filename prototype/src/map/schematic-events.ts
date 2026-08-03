const OPEN_SCHEMATIC_EVENT = "rig:open-schematic";

export function openSchematic() {
  window.dispatchEvent(new Event(OPEN_SCHEMATIC_EVENT));
}

export function onOpenSchematic(listener: () => void) {
  window.addEventListener(OPEN_SCHEMATIC_EVENT, listener);
  return () => window.removeEventListener(OPEN_SCHEMATIC_EVENT, listener);
}
