/**
 * Room header: title, output-device segmented toggle (mac|phone), connection
 * dot, "new session" (+) button, and the overflow menu.
 *
 * The device toggle persists to `mobile_output_device` via prefs and is the
 * grant output preference used by cards — display + behavior in one place.
 */
import type { OutputDevice } from "../prefs.js";
import { IconLaptop, IconPlus, IconSmartphone } from "../icons.js";
import { OverflowMenu } from "./OverflowMenu.js";

interface HeaderProps {
  connected: boolean;
  output: OutputDevice;
  held: boolean;
  catchUp: boolean;
  unheardCount: number;
  onSetOutput: (device: OutputDevice) => void;
  onToggleHold: () => void;
  onCatchUp: () => void;
  onStopCatchUp: () => void;
  onOpenPicker: () => void;
}

export function Header({
  connected,
  output,
  held,
  catchUp,
  unheardCount,
  onSetOutput,
  onToggleHold,
  onCatchUp,
  onStopCatchUp,
  onOpenPicker,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      <h1 className="mr-auto text-base font-semibold tracking-tight">Room of Devs</h1>

      <DeviceToggle output={output} onSetOutput={onSetOutput} />

      <span
        className={`inline-block size-2.5 shrink-0 rounded-full ${
          connected ? "bg-accent shadow-[0_0_8px] shadow-accent/60" : "bg-fg-faint"
        }`}
        aria-label={connected ? "Connected" : "Disconnected"}
        title={connected ? "Connected" : "Disconnected"}
      />

      <button
        type="button"
        className="grid size-9 place-items-center rounded-lg border border-line-strong text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-5"
        title="New session"
        aria-label="New session"
        onClick={onOpenPicker}
      >
        <IconPlus />
      </button>

      <OverflowMenu
        held={held}
        onToggleHold={onToggleHold}
        catchUp={catchUp}
        unheardCount={unheardCount}
        onCatchUp={onCatchUp}
        onStopCatchUp={onStopCatchUp}
      />
    </header>
  );
}

function DeviceToggle({
  output,
  onSetOutput,
}: {
  output: OutputDevice;
  onSetOutput: (device: OutputDevice) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Output device"
      className="flex items-center rounded-lg border border-line-strong p-0.5"
    >
      {(["mac", "phone"] as const).map((device) => {
        const active = output === device;
        const Icon = device === "mac" ? IconLaptop : IconSmartphone;
        return (
          <button
            key={device}
            type="button"
            aria-pressed={active}
            title={device === "mac" ? "Play on Mac" : "Play on this phone"}
            onClick={() => onSetOutput(device)}
            className={`grid size-8 place-items-center rounded-md transition-colors [&_svg]:size-5 ${
              active
                ? "bg-surface-strong text-accent"
                : "text-fg-faint hover:text-fg-muted"
            }`}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
