import type { FleetState, RoomBerth, RoomId, RoomState } from "./types";

const ARTIFACT_SVG = `<svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg">
  <rect width="280" height="140" fill="#0f0801"/>
  <g fill="none" stroke="#ffb347" stroke-width="1.2">
    <rect x="20" y="30" width="70" height="40" rx="3"/>
    <rect x="110" y="20" width="70" height="60" rx="3"/>
    <rect x="200" y="40" width="60" height="30" rx="3"/>
    <path d="M90 50 H110 M180 50 H200" stroke-dasharray="4 3"/>
    <circle cx="145" cy="50" r="6" fill="#ffb347"/>
  </g>
  <text x="20" y="110" fill="#ffb347" font-family="monospace" font-size="10" letter-spacing="1.5">SPINE · PLAN 0007 · HEADER PARITY</text>
  <text x="20" y="126" fill="#8a5c20" font-family="monospace" font-size="8" letter-spacing="1">CANNED DIAGRAM · KEEP OR DISCARD</text>
</svg>`;

/** Rich room fixture — 2 plans live/queued, 3 settled, 5 crafts, spend, watch, artifact. */
function makeRichFixtures(roomId: RoomId): RoomState {
  const now = Date.now();
  return {
    view: "console",
    mood: "normal",
    focusCraftId: "c-0452",
    rev: 4187,
    clock: "21:47:09",
    micHot: false,
    speakingPersona: null,
    nowPlaying: null,
    lastClip: {
      persona: "mikey",
      label: "T-0451 · WATCH ORDER",
      craftId: "c-0451",
      kind: "turn-final",
      startedAt: now - 42 * 60_000,
      text: "Watch order update on T-0451: tests green.",
    },
    liveClip: null,
    composerText: "",
    audio: { route: "phone", gateStartedAt: now - 2_000 },
    queuedForLull: ["shredder's svgo digest", "leo step 5"],
    dockTicker: "RAPH · WATCH ORDER ACTIVE · SPLINTER HOLDING PLAN 0007-B · LEO QUIET ON STEP 5",
    dockLedRed: false,
    donnieCheckout: {
      purpose: "WALK PLAN 0007-B",
      elapsed: "04:12",
    },
    turnChip: { model: "FLASH → OPUS", costUsd: 0.043 },
    dials: { ceremony: "full", voice: "mikey", brain: "deep" },
    voicePersona: "mikey",
    tapIn: null,
    heldQuestion: {
      craftId: "c-0449",
      heldSince: now - 401_000,
      prompt: "fold the mobile header into shared @room/ui?",
      options: [
        {
          id: "ship",
          label: "SHIP IT",
          detail: "approve the 3-step plan as written",
          speakHint: "SHIP IT",
          armed: true,
        },
        {
          id: "redline",
          label: "REDLINE",
          detail: "approve, but panel header stays put",
          speakHint: "OPTION TWO",
          armed: false,
        },
        {
          id: "hold",
          label: "HOLD",
          detail: "park it until round 2 ships",
          speakHint: "HOLD IT",
          armed: false,
        },
      ],
    },
    salience: {
      clearPct: 58,
      threshold: 35,
      contributors: [
        { label: "SPLINTER · PLAN HELD 06:41", delta: -22 },
        { label: "RAPH · WATCH ORDER ACTIVE", delta: -8 },
        { label: "LEO · QUIET", delta: -4 },
        { label: "SHREDDER · QUIET", delta: 6 },
      ],
    },
    spend: {
      monthFraction: 0.41,
      elevenlabsUsd: 4.1,
      elevenlabsCap: 10,
      geminiUsd: 1.84,
      geminiGoalUsd: 5,
      voiceCharsToday: 12480,
      burning: false,
      windowResetFraction: 0.62,
      windowResetLabel: "4D 09H",
      // Semantics are per-provider and NOT interchangeable — see GuardWindow.
      // sessionFraction (blue arc) exists only where a session actually resets.
      guards: [
        {
          id: "claude",
          label: "CLAUDE",
          // 5H session bucket resets; the Fable 7D window keeps climbing.
          sessionFraction: 0.28,
          windows: [
            { window: "5H SESSION", fraction: 0.28, readout: "28%" },
            { window: "FABLE 7D", fraction: 0.42, readout: "42%" },
          ],
        },
        {
          id: "codex",
          label: "CODEX",
          sessionFraction: 0.22,
          windows: [
            { window: "SESSION", fraction: 0.22, readout: "22%" },
            { window: "7D", fraction: 0.19, readout: "19%" },
          ],
        },
        {
          id: "cursor",
          label: "CURSOR",
          // 30-day rolling timer window. No session reset → no blue arc.
          sessionFraction: null,
          windows: [{ window: "30D ROLLING", fraction: 0.34, readout: "34% · 11D LEFT" }],
        },
        {
          id: "elevenlabs",
          label: "ELEVENLABS",
          // Token bank: +1K granted monthly, bank caps at 3K. No session reset.
          sessionFraction: null,
          windows: [{ window: "BANK · +1K/MO", fraction: 1.23 / 3, readout: "1.2K / 3K TOK" }],
        },
        {
          id: "gemini",
          label: "GEMINI",
          // No provider windows at all — month-to-date spend vs OUR goal.
          sessionFraction: null,
          windows: [
            {
              window: "MONTH",
              fraction: 1.84 / 5,
              readout: "$1.84 / GOAL $5",
            },
          ],
        },
      ],
    },
    plans: [
      {
        id: "0008",
        name: "Spine Validation Watchers",
        dock: "queued",
        steps: [],
        stepLabel: "",
        gearTag: "",
        status: "GATED ON #75 · NO THREADS SPAWNED",
        schematic: "queued",
      },
      {
        id: "0007",
        name: "UI Consolidation R2",
        dock: "live",
        steps: ["done", "done", "done", "done", "live", "todo"],
        stepLabel: "STEP 5/6 · PANEL HEADER PARITY · TURNS",
        gearTag: "DIAL 1 · GEAR: FULL",
        status: "STEP 5/6 · PANEL HEADER PARITY",
        schematic: "active",
      },
      {
        id: "0006",
        name: "Phase-7 Facade Splits",
        dock: "settled",
        steps: [],
        stepLabel: "",
        gearTag: "",
        status: "ARCHIVED · 9 THREADS · SHIPPED 07-23",
        schematic: "plain",
      },
      {
        id: "0005",
        name: "Mobile v2.3 Live Stream",
        dock: "settled",
        steps: [],
        stepLabel: "",
        gearTag: "",
        status: "ARCHIVED · SHIPPED 07-19",
        schematic: "plain",
      },
      {
        id: "0004",
        name: "Live Mode v2",
        dock: "settled",
        steps: [],
        stepLabel: "",
        gearTag: "",
        status: "ARCHIVED · SHIPPED 07-21",
        schematic: "plain",
      },
    ],
    crafts: [
      {
        roomId,
        id: "c-0451",
        ticket: "T-0451",
        persona: "raph",
        callsign: "RAPH",
        task: "prod bugfix: stale team_map on cross-persona spawn",
        state: "working",
        salience: 62,
        salienceDelta: -8,
        planId: "0007",
        lastStamp: "LAST EVENT 00:12 AGO",
        holdSeconds: 0,
        watched: true,
        open: false,
        tmux: true,
        tokens: 2140,
        spendUsd: 0.03,
        turns: 3,
        oneOff: false,
        plotAngle: 210,
        tail: [
          { kind: "cmd", text: "pnpm exec tsx src/index.ts once q-8842.json" },
          { kind: "ok", text: "ingest dedup clean · marker acquired" },
          { kind: "info", text: "patching team-map settle race in spawn hook…" },
          { kind: "typing", text: "re-running spawn scenario against fake session…" },
        ],
        diff: {
          file: "team.sh",
          lines: [
            { kind: "ctx", text: "@@ spawn_persona() @@" },
            { kind: "del", text: '- inject_prompt "$pane"' },
            { kind: "add", text: '+ wait_map_settled "$sid"' },
            { kind: "add", text: '+ inject_prompt "$pane"' },
          ],
        },
      },
      {
        roomId,
        id: "c-0452",
        ticket: "T-0452",
        persona: "leo",
        callsign: "LEO",
        task: "panel header parity — step 5 of plan 0007",
        state: "working",
        salience: 78,
        salienceDelta: -4,
        planId: "0007",
        lastStamp: "LAST EVENT 01:38 AGO",
        holdSeconds: 0,
        watched: false,
        open: true,
        tmux: true,
        tokens: 5860,
        spendUsd: 0.08,
        turns: 7,
        oneOff: false,
        plotAngle: 320,
        tail: [
          { kind: "cmd", text: "pnpm typecheck" },
          { kind: "ok", text: "0 errors · 4 packages" },
          { kind: "info", text: "aligning TransportBar tokens with mobile header…" },
          { kind: "info", text: "--room-accent now sourced from tokens.css, both realms" },
          { kind: "typing", text: "pnpm --filter @room/mobile build…" },
        ],
        diff: {
          file: "TransportBar.tsx",
          lines: [
            { kind: "ctx", text: "@@ header variant @@" },
            { kind: "del", text: '- color: "#f5a623"' },
            { kind: "add", text: '+ color: "var(--room-accent)"' },
            { kind: "ctx", text: "  // tokens.css is the authority" },
          ],
        },
      },
      {
        roomId,
        id: "c-0449",
        ticket: "T-0449",
        persona: "splinter",
        callsign: "SPLINTER",
        task: "docs round C review — plan 0007-B held for approval",
        state: "needs-you",
        salience: 18,
        salienceDelta: -22,
        planId: "0007",
        lastStamp: "HOLDING 06:41",
        holdSeconds: 401,
        watched: false,
        open: true,
        tmux: true,
        tokens: 1020,
        spendUsd: 0.08,
        turns: 2,
        oneOff: false,
        plotAngle: 150,
        tail: [{ kind: "info", text: "? fold the mobile header into shared @room/ui?" }],
        diff: null,
      },
      {
        roomId,
        id: "c-0447",
        ticket: "T-0447",
        persona: "shredder",
        callsign: "SHREDDER",
        task: "svgo pass on docs-publish — finished, logged only",
        state: "settled",
        salience: 92,
        salienceDelta: 6,
        planId: "0007",
        lastStamp: "WAITING FOR LULL",
        holdSeconds: 0,
        watched: false,
        open: false,
        tmux: false,
        tokens: 640,
        spendUsd: 0.01,
        turns: 1,
        oneOff: false,
        plotAngle: 40,
        tail: [
          { kind: "ok", text: "14 svgs minified · docs:publish clean" },
          { kind: "info", text: "mikey will mention it at the next lull" },
        ],
        diff: null,
      },
      {
        roomId,
        id: "c-empty",
        ticket: "T-————",
        persona: "karai",
        callsign: "KARAI",
        task: "— empty bay —",
        state: "empty",
        salience: 100,
        salienceDelta: 0,
        planId: null,
        lastStamp: "",
        holdSeconds: 0,
        watched: false,
        open: false,
        tmux: false,
        tokens: 0,
        spendUsd: 0,
        turns: 0,
        oneOff: false,
        plotAngle: 0,
        tail: [],
        diff: null,
      },
    ],
    verbs: [
      {
        id: "v-standby",
        utterance: "STAND BY ON PROD",
        params: "LIVE · WATCH ORDER",
        fieldLabel: "Watches the prod fix and speaks up at every real step.",
        on: true,
        gatedIssue: null,
      },
      {
        id: "v-lull",
        utterance: "SPEAK AT THE LULL",
        params: "SETTLED QUEUE",
        fieldLabel: "Holds finished news until the room goes quiet.",
        on: true,
        gatedIssue: null,
      },
      {
        id: "v-gated",
        utterance: "SPIN UP WATCHERS",
        params: "PLAN 0008",
        fieldLabel: "Would put watchers on a plan — not built yet.",
        on: false,
        gatedIssue: 75,
      },
    ],
    artifacts: [
      {
        id: "a-diagram-1",
        title: "HEADER PARITY DIAGRAM",
        craftId: "c-oneoff",
        status: "pending",
        svg: ARTIFACT_SVG,
      },
    ],
    transcript: [
      {
        who: "YOU",
        text: "mikey, keep me posted on the prod bug fix — diagnosis and updates.",
        you: true,
        at: now - 3 * 60 * 60_000 - 8 * 60_000,
      },
      {
        who: "MIKEY",
        text: "On it. Raph's chasing the stale team-map spawn. First read: the hook fires before the map settles. I'll speak up at each real step.",
        at: now - 3 * 60 * 60_000 - 6 * 60_000,
      },
      {
        who: "YOU",
        text: "keep the watch order on until staging clears",
        you: true,
        at: now - 3 * 60 * 60_000 - 4 * 60_000,
      },
      {
        who: "MIKEY",
        text: "Update — fix staged, tests green. Splinter's still holding a plan for you when you want it.",
        at: now - 44 * 60_000,
      },
      {
        who: "YOU",
        text: "ship it",
        you: true,
        at: now - 42 * 60_000,
      },
      {
        who: "MIKEY",
        text: "Cowabunga — Raph's still on the watch order.",
        at: now - 40 * 60_000,
      },
      {
        who: "MIKEY",
        text: "Long read for the log: Raph traced the stale team-map spawn through the hook handoff, confirmed the first paint was racing the room manifest, and moved the reconciliation behind the settled snapshot. The focused transcript keeps the diagnosis, the validation pass, and this full handoff readable without squeezing the spine or taking the live instruments off the board.",
        at: now - 2 * 60_000,
      },
    ],
    crew: [
      { id: "mikey", callsign: "MIKEY", role: "CREW CHIEF", piloting: false },
      { id: "donnie", callsign: "DONNIE", role: "SECOND VOICE", piloting: true },
      { id: "leo", callsign: "LEO", role: "CRAFT T-0452", piloting: true },
      { id: "raph", callsign: "RAPH", role: "CRAFT T-0451", piloting: true },
      { id: "splinter", callsign: "SPLINTER", role: "CRAFT T-0449", piloting: true },
      { id: "shredder", callsign: "SHREDDER", role: "SETTLED", piloting: false },
      { id: "karai", callsign: "KARAI", role: "STANDBY", piloting: false },
    ],
  };
}

function fixtureCraft(room: RoomState, index: number) {
  const craft = room.crafts[index];
  if (!craft) throw new Error(`Missing fixture craft at index ${index}`);
  return craft;
}

function makePodlinkFixtures(roomId: RoomId): RoomState {
  const rich = makeRichFixtures(roomId);
  const craft = {
    ...fixtureCraft(rich, 0),
    roomId,
    id: "pod-w-2",
    ticket: "W-2",
    persona: "raph" as const,
    callsign: "RAPH",
    task: "release watch · 5xx anomaly baseline",
    salience: 64,
    salienceDelta: -12,
    planId: "0031",
    lastStamp: "WATCH ACTIVE · 02:18",
    watched: true,
    open: false,
    tokens: 940,
    spendUsd: 0.01,
    turns: 2,
    plotAngle: 205,
    tail: [{ kind: "info" as const, text: "watching release telemetry · baseline stable" }],
    diff: null,
  };
  return {
    ...rich,
    dials: { ...rich.dials, ceremony: "light" },
    focusCraftId: craft.id,
    plans: [
      {
        id: "0031",
        name: "Release Watch",
        dock: "live",
        steps: ["done", "live", "todo"],
        stepLabel: "STEP 2/3 · WATCH RELEASE",
        gearTag: "DIAL 1 · GEAR: LIGHT",
        status: "WATCHING PROD",
        schematic: "active",
      },
      {
        id: "0030",
        name: "Feed Envelope",
        dock: "settled",
        steps: [],
        stepLabel: "",
        gearTag: "",
        status: "ARCHIVED · SHIPPED 07-27",
        schematic: "plain",
      },
    ],
    crafts: [craft],
    heldQuestion: null,
    salience: {
      clearPct: 64,
      threshold: 35,
      contributors: [{ label: "RAPH · RELEASE WATCH ACTIVE", delta: -12 }],
    },
    artifacts: [],
    donnieCheckout: null,
    transcript: [
      {
        who: "MIKEY",
        text: "Podlink is on release watch. Raph has the only craft out.",
        at: Date.now() - 6 * 60_000,
      },
    ],
    crew: rich.crew.map((member) => ({
      ...member,
      piloting: member.id === "raph",
      role: member.id === "raph" ? "WATCHER W-2" : member.id === "mikey" ? "CREW CHIEF" : "STANDBY",
    })),
    queuedForLull: [],
    dockTicker: "RAPH · RELEASE WATCH ACTIVE · BASELINE STABLE",
  };
}

function makeComicReaderFixtures(roomId: RoomId): RoomState {
  const rich = makeRichFixtures(roomId);
  const craft = {
    ...fixtureCraft(rich, 1),
    roomId,
    id: "comic-t-0912",
    ticket: "T-0912",
    persona: "leo" as const,
    callsign: "LEO",
    task: "reader turn final · panel crop parity",
    salience: 74,
    salienceDelta: -6,
    planId: "0007",
    lastStamp: "LAST EVENT 01:04 AGO",
    tokens: 1680,
    spendUsd: 0.02,
    turns: 3,
    plotAngle: 315,
    tail: [{ kind: "typing" as const, text: "finishing panel crop parity…" }],
    diff: null,
  };
  return {
    ...rich,
    dials: { ...rich.dials, ceremony: "light" },
    focusCraftId: craft.id,
    plans: [
      {
        id: "0007",
        name: "Reader Crop Parity",
        dock: "live",
        steps: ["done", "done", "live"],
        stepLabel: "STEP 3/3 · TURN FINAL",
        gearTag: "DIAL 1 · GEAR: LIGHT",
        status: "TURN FINAL",
        schematic: "active",
      },
    ],
    crafts: [craft],
    heldQuestion: null,
    salience: {
      clearPct: 74,
      threshold: 35,
      contributors: [{ label: "LEO · TURN FINAL", delta: -6 }],
    },
    artifacts: [],
    donnieCheckout: null,
    transcript: [
      {
        who: "MIKEY",
        text: "Comic Reader has one craft finishing the crop-parity turn.",
        at: Date.now() - 4 * 60_000,
      },
    ],
    crew: rich.crew.map((member) => ({
      ...member,
      piloting: member.id === "leo",
      role: member.id === "leo" ? "CRAFT T-0912" : member.id === "mikey" ? "CREW CHIEF" : "STANDBY",
    })),
    queuedForLull: ["leo turn final"],
    dockTicker: "LEO · TURN FINAL · QUEUED FOR THE LULL",
  };
}

function makeScratchFixtures(roomId: RoomId): RoomState {
  const rich = makeRichFixtures(roomId);
  const craft = {
    ...fixtureCraft(rich, 0),
    roomId,
    id: "scratch-exif",
    ticket: "T-1OFF",
    persona: "donnie" as const,
    callsign: "DONNIE",
    task: "exif sweep — photo library",
    state: "working" as const,
    salience: 88,
    salienceDelta: -2,
    planId: null,
    lastStamp: "RUNNING 04:12",
    watched: false,
    open: false,
    tmux: false,
    tokens: 410,
    spendUsd: 0.01,
    turns: 1,
    oneOff: true,
    plotAngle: 175,
    tail: [{ kind: "info" as const, text: "one-off sweep · dies on delivery" }],
    diff: null,
  };
  return {
    ...rich,
    focusCraftId: craft.id,
    plans: [],
    crafts: [craft],
    heldQuestion: null,
    salience: {
      clearPct: 88,
      threshold: 35,
      contributors: [{ label: "DONNIE · ONE-OFF RUNNING", delta: 0 }],
    },
    artifacts: [],
    donnieCheckout: null,
    transcript: [
      {
        who: "MIKEY",
        text: "One-off EXIF sweep running from room-of-devs.",
        at: Date.now() - 3 * 60_000,
      },
    ],
    crew: rich.crew.map((member) => ({
      ...member,
      piloting: false,
      role: member.id === "mikey" ? "NARRATOR" : "STANDBY",
    })),
    queuedForLull: [],
    dockTicker: "ONE-OFF · DIES ON DELIVERY",
  };
}

/** One full RoomState fixture for the requested room. */
export function makeFixtures(roomId: RoomId): RoomState {
  if (roomId === "podlink") return makePodlinkFixtures(roomId);
  if (roomId === "comic-reader") return makeComicReaderFixtures(roomId);
  if (roomId === "scratch-exif") return makeScratchFixtures(roomId);
  return makeRichFixtures(roomId);
}

export const SCRATCH_ROOM_ID = "scratch-exif";

export function makeFleetFixtures(): {
  fleet: FleetState;
  rooms: Record<RoomId, RoomState>;
} {
  const roomIds = ["room-of-devs", "podlink", "comic-reader", SCRATCH_ROOM_ID] as const;
  const rooms = Object.fromEntries(
    roomIds.map((roomId) => [roomId, makeFixtures(roomId)]),
  ) as Record<RoomId, RoomState>;
  const berths: RoomBerth[] = [
    {
      id: "room-of-devs",
      manifest: {
        room: "room-of-devs",
        name: "room-of-devs",
        repo: "dougiefresh49/cursor-read-aloud",
        ceremony: "full",
        spine: { tracker: "github", repo: "dougiefresh49/cursor-read-aloud" },
        cast: {
          lead: "mikey",
          checkout: ["donnie", "leo", "raph", "splinter", "shredder", "karai"],
        },
        gearDefault: "full",
        brainTable: "std",
        connectors: ["gh-issues", "tmux", "vercel", "sentry"],
      },
      berth: 1,
      parentRoomId: null,
      salience: { clearPct: 58, worstCraftId: "c-0449" },
      counts: { working: 2, needsYou: 1, settled: 1, watchers: 1 },
      docked: { live: 1, queued: 1, settled: 3 },
      ticker: "DONNIE HOLDING QUESTION · T-0449 · 06:41",
    },
    {
      id: "podlink",
      manifest: {
        room: "podlink",
        name: "podlink",
        repo: "dougiefresh49/podlink",
        ceremony: "full",
        spine: { tracker: "github", repo: "dougiefresh49/podlink" },
        cast: { lead: "raph", checkout: ["mikey"] },
        gearDefault: "light",
        brainTable: "lean",
        connectors: ["gh-issues", "vercel", "sentry"],
      },
      berth: 2,
      parentRoomId: null,
      salience: { clearPct: 64, worstCraftId: "pod-w-2" },
      counts: { working: 1, needsYou: 0, settled: 0, watchers: 1 },
      docked: { live: 1, queued: 0, settled: 1 },
      ticker: "W-2 RELEASE WATCH · BASELINE STABLE",
    },
    {
      id: "comic-reader",
      manifest: {
        room: "comic-reader",
        name: "comic-reader",
        repo: "dougiefresh49/comic-reader",
        ceremony: "full",
        spine: { tracker: "github", repo: "dougiefresh49/comic-reader" },
        cast: { lead: "leo", checkout: ["mikey"] },
        gearDefault: "light",
        brainTable: "std",
        connectors: ["gh-issues", "tmux"],
      },
      berth: 3,
      parentRoomId: null,
      salience: { clearPct: 74, worstCraftId: "comic-t-0912" },
      counts: { working: 1, needsYou: 0, settled: 0, watchers: 0 },
      docked: { live: 1, queued: 0, settled: 0 },
      ticker: "T-0912 TURN FINAL · QUEUED FOR THE LULL",
    },
    {
      id: SCRATCH_ROOM_ID,
      manifest: {
        room: SCRATCH_ROOM_ID,
        name: "exif sweep — photo library",
        repo: "",
        ceremony: "one-off",
        spine: null,
        cast: { lead: "mikey", checkout: ["donnie"] },
        gearDefault: "bare",
        brainTable: "lean",
        connectors: [],
      },
      berth: null,
      parentRoomId: "room-of-devs",
      salience: { clearPct: 88, worstCraftId: "scratch-exif" },
      counts: { working: 1, needsYou: 0, settled: 0, watchers: 0 },
      docked: { live: 0, queued: 0, settled: 0 },
      ticker: "MIKEY NARRATES · RUNNING 04:12 · DIES ON DELIVERY",
    },
  ];
  return {
    rooms,
    fleet: {
      zoom: "hangar",
      activeRoomId: "room-of-devs",
      rooms: berths,
      traffic: [
        {
          roomId: "room-of-devs",
          craftId: "c-0449",
          label: "T-0449 · SPLINTER HOLDING A QUESTION · HELD 06:41",
          salience: 18,
          belowGate: true,
          floorState: "lull",
        },
        {
          roomId: "podlink",
          craftId: "pod-w-2",
          label: "W-2 RELEASE WATCH · BASELINE STABLE",
          salience: 64,
          belowGate: false,
          floorState: "queued",
        },
        {
          roomId: "comic-reader",
          craftId: "comic-t-0912",
          label: "T-0912 · TURN FINAL · QUEUED FOR THE LULL",
          salience: 74,
          belowGate: false,
          floorState: "lull",
        },
      ],
      audioFloor: {
        roomId: null,
        persona: null,
        elapsed: "00:00",
        route: "phone",
        queue: [{ roomId: "podlink", reason: "release watch update" }],
      },
      threshold: 35,
      commission: null,
    },
  };
}
