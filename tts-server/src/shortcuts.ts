import { loadArcadeButtons, type ArcadeButton } from "./config.js";

export type ShortcutSection = {
  title: string;
  rows: Array<[string, string]>;
};

// Hand-synced with matchGrammar() in voice.ts — update both when adding phrases.
export const VOICE_GRAMMAR_ROWS: Array<[string, string]> = [
  ["go ahead / go [name]", "Grant the floor to a named agent, or next in queue if omitted"],
  ["pause / hold on / wait", "Pause playback"],
  ["resume / continue / keep going", "Resume playback"],
  ["stop / enough / shut up", "Stop current playback"],
  ["cancel / cancel that / never mind", "Cancel an in-flight inject"],
  ["hold (the) room [for N minutes]", "Hold the room (optional timed hold)"],
  ["release room / open room", "Release a held room"],
  ["say (that) again / repeat / again", "Replay the last message"],
  ["say (that) again slower / repeat slower", "Replay the last message slower"],
  ["status / who's up / who is waiting", "Speak a room status summary"],
  ["focus / arcade / quiet / normal mode", "Switch mood preset"],
  ["mute <name>", "Mute an agent's readouts"],
  ["unmute <name>", "Unmute an agent"],
  ["clear / never mind / skip <name>", "Clear an agent's queued items"],
  ["tell / talk to / ask / hey <name>, <message>", "Inject a prompt to a team agent"],
  ["run the <command> (slash) command [for <name>]", "Send a slash command to a team agent"],
];

const KEYBOARD_HOTKEYS: Array<[string, string]> = [
  ["Ctrl+Shift+P", "Pause / resume playback"],
  ["Ctrl+Shift+R", "Replay last message"],
  ["Ctrl+Shift+G", "Grant floor to next agent"],
  ["Ctrl+Shift+Space", "Stop playback"],
];

function describeButton(btn: ArcadeButton): string {
  if (btn.character) {
    const who = btn.character;
    const hold = `Hold → push-to-talk to ${who}`;
    const triple = `Triple-tap → room status for ${who}`;
    return `Tap → grant floor to ${who} (or duck if speaking); ${hold}; ${triple}`;
  }
  const tap = btn.action ? `Tap → ${btn.action}` : "Tap → (unassigned)";
  if (btn.hold_action && btn.hold_action !== btn.action) {
    return `${tap}; Hold → ${btn.hold_action}`;
  }
  if (btn.action) return `${tap} (hold repeats tap)`;
  return tap;
}

function buildButtonRows(): Array<[string, string]> {
  const cfg = loadArcadeButtons();
  const rows: Array<[string, string]> = [];
  for (const [idx, btn] of Object.entries(cfg.buttons).sort(
    (a, b) => Number(a[0]) - Number(b[0])
  )) {
    const label = btn.name || `Button ${idx}`;
    rows.push([label, describeButton(btn)]);
  }
  if (rows.length === 0) {
    rows.push(["(none mapped)", "Run hid.ts learn or map buttons in the panel"]);
  }
  return rows;
}

export function buildShortcutsPayload(): { type: "shortcuts"; sections: ShortcutSection[] } {
  return {
    type: "shortcuts",
    sections: [
      { title: "Voice commands", rows: VOICE_GRAMMAR_ROWS },
      { title: "Keyboard hotkeys", rows: KEYBOARD_HOTKEYS },
      { title: "Arcade buttons", rows: buildButtonRows() },
    ],
  };
}
