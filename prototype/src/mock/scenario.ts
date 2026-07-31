import { speak as mockSpeak, stopSpeaking } from "../audio/mock";
import { makeFixtures } from "./fixtures";
import { getRoom, patchRoom, setRoom } from "./store";
import type { Craft, PersonaId, RoomState } from "./types";

function fmtHold(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `HOLDING ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function mapCraft(
  crafts: Craft[],
  id: string,
  fn: (c: Craft) => Craft,
): Craft[] {
  return crafts.map((c) => (c.id === id ? fn(c) : c));
}

function speakMikey(line: string) {
  patchRoom({ speakingPersona: "mikey" });
  void mockSpeak(line, "mikey").finally(() => {
    patchRoom({ speakingPersona: null });
  });
}

/** SPAWN CRAFT — birth at top of rail → materialize → working. */
export function spawnCraft() {
  const id = `c-spawn-${Date.now()}`;
  const birth: Craft = {
    id,
    ticket: "T-0453",
    persona: "karai",
    callsign: "KARAI",
    task: "reads the spine, not anyone's history",
    state: "spawning",
    salience: 100,
    planId: "0007",
    lastStamp: "MATERIALIZING",
    holdSeconds: 0,
    watched: false,
    open: false,
    tmux: true,
    tokens: 0,
    spendUsd: 0,
    turns: 0,
    oneOff: false,
    plotAngle: 260,
    tail: [{ kind: "info", text: "birth slot · clamping to plan 0007…" }],
    diff: null,
  };
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    mood: "normal",
    plans: [
      {
        id: "birth",
        name: "New Craft Birth",
        dock: "birth",
        steps: [],
        stepLabel: "",
        gearTag: "",
        status: "SPAWNING · TOP OF RAIL",
        schematic: "queued",
      },
      ...s.plans.filter((p) => p.dock !== "birth"),
    ],
    crafts: [birth, ...s.crafts.filter((c) => c.state !== "empty")],
    crew: s.crew.map((m) =>
      m.id === "karai" ? { ...m, piloting: true, role: "CRAFT T-0453" } : m,
    ),
  }));
  window.setTimeout(() => {
    setRoom((s) => ({
      ...s,
      rev: s.rev + 1,
      plans: s.plans.filter((p) => p.dock !== "birth"),
      crafts: mapCraft(s.crafts, id, (c) => ({
        ...c,
        state: "working",
        salience: 88,
        lastStamp: "LAST EVENT 00:00 AGO",
        task: "spine validation probe — newborn",
      })),
    }));
  }, 1600);
}

/** HAND RAISE — ARRIVAL choreography. */
export function handRaise(craftId = "c-0451") {
  setRoom((s) => {
    const crafts = mapCraft(s.crafts, craftId, (c) => ({
      ...c,
      state: "needs-you" as const,
      salience: Math.min(c.salience, 22),
      holdSeconds: Math.max(c.holdSeconds, 12),
      lastStamp: fmtHold(Math.max(c.holdSeconds, 12)),
      open: true,
    }));
    const clearPct = Math.min(
      40,
      Math.round(
        crafts
          .filter((c) => c.state !== "empty")
          .reduce((a, c) => a + c.salience, 0) /
          Math.max(1, crafts.filter((c) => c.state !== "empty").length),
      ),
    );
    return {
      ...s,
      rev: s.rev + 1,
      mood: "arrival",
      dockLedRed: true,
      focusCraftId: craftId,
      crafts,
      salience: {
        ...s.salience,
        clearPct,
        contributors: [
          { label: "HAND RAISE · ARRIVAL", delta: -30 },
          ...s.salience.contributors.slice(0, 2),
        ],
      },
    };
  });
  speakMikey("Heads up — a craft just raised its hand. One sentence at the lull.");
}

/** HELD QUESTION on craft N. */
export function heldQuestion(craftId = "c-0449") {
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    mood: "normal",
    focusCraftId: craftId,
    crafts: mapCraft(s.crafts, craftId, (c) => ({
      ...c,
      state: "needs-you",
      open: true,
      salience: Math.min(c.salience, 20),
      holdSeconds: c.holdSeconds || 120,
      lastStamp: fmtHold(c.holdSeconds || 120),
    })),
    heldQuestion: {
      craftId,
      prompt: "ship the salience threshold as a live config, or park it?",
      options: [
        {
          id: "ship",
          label: "SHIP IT",
          detail: "wire the draggable tab to config",
          speakHint: "SHIP IT",
          armed: true,
        },
        {
          id: "park",
          label: "PARK",
          detail: "leave threshold read-only for now",
          speakHint: "PARK IT",
          armed: false,
        },
        {
          id: "later",
          label: "LATER",
          detail: "queue behind plan 0008",
          speakHint: "LATER",
          armed: false,
        },
      ],
    },
  }));
}

/** ANSWER by keycap — resolves held question. */
export function answer(optionId: string, speakIt = false) {
  const s = getRoom();
  const hq = s.heldQuestion;
  if (!hq) return;
  const opt = hq.options.find((o) => o.id === optionId);
  if (!opt) return;
  const line = speakIt
    ? `Speaking it — ${opt.speakHint}. Resolved.`
    : `Got it — ${opt.label}.`;
  setRoom((prev) => ({
    ...prev,
    rev: prev.rev + 1,
    heldQuestion: null,
    mood: "normal",
    dockLedRed: false,
    crafts: mapCraft(prev.crafts, hq.craftId, (c) => ({
      ...c,
      state: "working",
      salience: Math.max(55, c.salience),
      holdSeconds: 0,
      lastStamp: "LAST EVENT 00:00 AGO",
      tail: [
        ...c.tail,
        { kind: "ok" as const, text: `answered · ${opt.label}` },
      ],
    })),
    transcript: [
      ...prev.transcript,
      { who: "YOU" as const, text: opt.speakHint, you: true },
      { who: "MIKEY" as const, text: line },
    ],
  }));
  if (speakIt) speakMikey(line);
}

/** SPEAK — Mikey canned line. */
export function speak() {
  const line =
    "Cowabunga — Raph's still on the watch order. I'll ping you at the next real step.";
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    transcript: [...s.transcript, { who: "MIKEY", text: line }],
  }));
  speakMikey(line);
}

/** DONNIE CHECKOUT. */
export function donnieCheckout() {
  patchRoom({
    donnieCheckout: { purpose: "WALK PLAN 0007-B", elapsed: "00:00" },
    speakingPersona: "donnie",
  });
  void mockSpeak(
    "Checking out. I'll walk the held plan with you.",
    "donnie",
  ).finally(() => patchRoom({ speakingPersona: null }));
}

/** Thanks Donnie — return. */
export function thanksDonnie() {
  stopSpeaking();
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    donnieCheckout: null,
    speakingPersona: "mikey",
    transcript: [
      ...s.transcript,
      { who: "YOU", text: "thanks Donnie", you: true },
      { who: "MIKEY", text: "He's back on the rack. I'm on voice." },
    ],
  }));
  void mockSpeak("He's back on the rack. I'm on voice.", "mikey").finally(() =>
    patchRoom({ speakingPersona: null }),
  );
}

/** LIVE CLIP tick on watched craft. */
export function liveClip() {
  const s = getRoom();
  const watched = s.crafts.find((c) => c.watched) ?? s.crafts[0];
  if (!watched) return;
  const clip = `LIVE · ${watched.ticket} · tests green · staging patch`;
  const queueLine = `${watched.callsign.toLowerCase()}'s live clip`;
  setRoom((prev) => ({
    ...prev,
    rev: prev.rev + 1,
    liveClip: clip,
    queuedForLull: prev.queuedForLull.includes(queueLine)
      ? prev.queuedForLull
      : [...prev.queuedForLull, queueLine].slice(-4),
    crafts: mapCraft(prev.crafts, watched.id, (c) => ({
      ...c,
      lastStamp: "LAST EVENT 00:00 AGO",
      tail: [
        ...c.tail.filter((t) => t.kind !== "typing"),
        { kind: "ok" as const, text: "tests green · staging patch" },
        { kind: "typing" as const, text: "narrating live clip…" },
      ],
    })),
    transcript: [
      ...prev.transcript,
      { who: "MIKEY", text: `Watch order update on ${watched.ticket}: tests green.` },
    ],
  }));
  speakMikey(`Watch order — ${watched.callsign} just cleared tests.`);
}

/** SETTLE craft N. */
export function settleCraft(craftId = "c-0452") {
  setRoom((s) => {
    const craft = s.crafts.find((c) => c.id === craftId);
    if (!craft) return s;
    const queueLine = `${craft.callsign.toLowerCase()}'s conclusions`;
    return {
      ...s,
      rev: s.rev + 1,
      mood: "normal",
      queuedForLull: s.queuedForLull.includes(queueLine)
        ? s.queuedForLull
        : [...s.queuedForLull, queueLine].slice(-4),
      crafts: mapCraft(s.crafts, craftId, (c) => ({
        ...c,
        state: "settled" as const,
        salience: 95,
        open: false,
        watched: false,
        lastStamp: "WAITING FOR LULL",
        tail: [
          ...c.tail,
          { kind: "ok" as const, text: "conclusions → spine · craft scrapped" },
        ],
      })),
      crew: s.crew.map((m) =>
        m.id === craft.persona
          ? { ...m, piloting: false, role: "STANDBY" }
          : m,
      ),
      dockTicker: `${craft.callsign} SETTLED · CONCLUSIONS ON SPINE`,
    };
  });
}

/** THE LULL — everything settled. */
export function theLull() {
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    mood: "the-lull",
    dockLedRed: false,
    heldQuestion: null,
    micHot: false,
    queuedForLull: [],
    salience: {
      clearPct: 100,
      threshold: s.salience.threshold,
      contributors: [{ label: "ALL QUIET · THE LULL", delta: 0 }],
    },
    crafts: s.crafts.map((c) =>
      c.state === "empty"
        ? c
        : {
            ...c,
            state: "settled" as const,
            salience: 98,
            open: false,
            watched: false,
            holdSeconds: 0,
            lastStamp: "WAITING FOR LULL",
          },
    ),
    crew: s.crew.map((m) =>
      m.id === "mikey" ? m : { ...m, piloting: false, role: "STANDBY" },
    ),
    transcript: [
      ...s.transcript,
      {
        who: "MIKEY",
        text: "That's the lull — spine green top to bottom. Nice work.",
      },
    ],
  }));
  speakMikey("That's the lull — spine green top to bottom. Nice work.");
}

/** MIC OPEN — everything dims a stop. */
export function micOpen() {
  patchRoom({ mood: "mic-open", micHot: true });
}

export function micClose() {
  patchRoom({ mood: "normal", micHot: false });
}

/** TAP-IN Q&A. */
export function tapInQa() {
  const q = "what's blocking salience wire-up?";
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    tapIn: {
      question: q,
      interpreter: "FLASH · TICKET 0007 · $0.002",
      answer: null,
    },
    turnChip: { model: "FLASH", costUsd: 0.002 },
  }));
  window.setTimeout(() => {
    const answer =
      "Threshold is mock-only in the prototype — daemon config hook is the next wire.";
    setRoom((s) => ({
      ...s,
      rev: s.rev + 1,
      tapIn: s.tapIn ? { ...s.tapIn, answer } : null,
      transcript: [
        ...s.transcript,
        { who: "YOU", text: q, you: true },
        { who: "MIKEY", text: answer },
      ],
    }));
    speakMikey(answer);
  }, 700);
}

/** DIAGRAM ARTIFACT — one-off craft → card → canned SVG. */
export function diagramArtifact() {
  const id = `c-oneoff-${Date.now()}`;
  const svg = makeFixtures().artifacts[0]?.svg ?? "";
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    crafts: [
      {
        id,
        ticket: "T-1OFF",
        persona: "donnie",
        callsign: "DONNIE",
        task: "one-off diagram — no conduit, dies on delivery",
        state: "working",
        salience: 70,
        planId: null,
        lastStamp: "LAST EVENT 00:00 AGO",
        holdSeconds: 0,
        watched: false,
        open: true,
        tmux: false,
        tokens: 400,
        spendUsd: 0.01,
        turns: 1,
        oneOff: true,
        plotAngle: 175,
        tail: [{ kind: "ok", text: "diagram rendered · awaiting KEEP THAT" }],
        diff: null,
      },
      ...s.crafts,
    ],
    artifacts: [
      {
        id: `a-${Date.now()}`,
        title: "SPINE DIAGRAM",
        craftId: id,
        status: "pending",
        svg,
      },
      ...s.artifacts,
    ],
    focusCraftId: id,
    view: "console",
  }));
}

export function keepArtifact(artifactId: string) {
  setRoom((s) => {
    const craftId = s.artifacts.find((a) => a.id === artifactId)?.craftId;
    return {
      ...s,
      rev: s.rev + 1,
      artifacts: s.artifacts.map((a) =>
        a.id === artifactId ? { ...a, status: "kept" as const } : a,
      ),
      // One-off is mortal either way: keep = artifact graduates to the
      // spine, then the craft dies on delivery (pilot back on the manifest).
      crafts: s.crafts.map((c) =>
        c.id === craftId
          ? {
              ...c,
              state: "settled" as const,
              open: false,
              salience: 100,
              task: "diagram kept → attached to spine · died on delivery",
              tail: [{ kind: "ok" as const, text: "artifact graduated · craft scrapped" }],
            }
          : c,
      ),
    };
  });
}

export function discardArtifact(artifactId: string) {
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    artifacts: s.artifacts.map((a) =>
      a.id === artifactId ? { ...a, status: "discarded" as const } : a,
    ),
    crafts: s.crafts.filter(
      (c) => c.id !== s.artifacts.find((a) => a.id === artifactId)?.craftId,
    ),
  }));
}

/** SPEND BURN — CORE pulse + odometer + dial creep. */
export function spendBurn() {
  setRoom((s) => {
    const elUsd = Math.min(
      s.spend.elevenlabsCap,
      +(s.spend.elevenlabsUsd + 0.35).toFixed(2),
    );
    const gemUsd = +(s.spend.geminiUsd + 0.02).toFixed(2);
    return {
      ...s,
      rev: s.rev + 1,
      spend: {
        ...s.spend,
        burning: true,
        monthFraction: Math.min(1, s.spend.monthFraction + 0.04),
        elevenlabsUsd: elUsd,
        geminiUsd: gemUsd,
        voiceCharsToday: s.spend.voiceCharsToday + 420,
        // The two guards a synthesis burn actually moves. Neither has a
        // session reset, so neither grows a blue arc.
        guards: s.spend.guards.map((g) => {
          if (g.id === "elevenlabs") {
            return {
              ...g,
              windows: [
                {
                  window: "30D",
                  fraction: elUsd / s.spend.elevenlabsCap,
                  readout: `$${elUsd.toFixed(2)} / $${s.spend.elevenlabsCap}`,
                },
              ],
            };
          }
          if (g.id === "gemini") {
            return {
              ...g,
              windows: [
                {
                  window: "MONTH",
                  fraction: gemUsd / s.spend.geminiGoalUsd,
                  readout: `$${gemUsd.toFixed(2)} / GOAL $${s.spend.geminiGoalUsd}`,
                },
              ],
            };
          }
          return g;
        }),
      },
    };
  });
  window.setTimeout(() => {
    patchRoom({ spend: { ...getRoom().spend, burning: false } });
  }, 2200);
}

/** TIME ×10 — ages hold timers, drifts salience. */
export function timeTimes10() {
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    crafts: s.crafts.map((c) => {
      if (c.state === "needs-you") {
        const hold = c.holdSeconds + 60;
        return {
          ...c,
          holdSeconds: hold,
          lastStamp: fmtHold(hold),
          salience: Math.max(5, c.salience - 4),
        };
      }
      if (c.state === "working") {
        return {
          ...c,
          salience: Math.min(100, c.salience + 3),
          lastStamp: "LAST EVENT 00:00 AGO",
        };
      }
      if (c.state === "settled") {
        return { ...c, salience: Math.min(100, c.salience + 2) };
      }
      return c;
    }),
    salience: {
      ...s.salience,
      clearPct: Math.min(100, s.salience.clearPct + 2),
    },
    // The 7-day window drains with the clock — the CORE's energy ball shrinks.
    spend: {
      ...s.spend,
      windowResetFraction: Math.max(0, s.spend.windowResetFraction - 0.12),
      windowResetLabel: `${Math.max(
        0,
        Math.round(Math.max(0, s.spend.windowResetFraction - 0.12) * 7 * 10) /
          10,
      ).toFixed(1)}D`,
    },
    donnieCheckout: s.donnieCheckout
      ? {
          ...s.donnieCheckout,
          elapsed: "04:22",
        }
      : null,
  }));
}

/** RESET. */
export function reset() {
  stopSpeaking();
  setRoom(makeFixtures());
}

export function setView(view: RoomState["view"], focusCraftId?: string | null) {
  patchRoom({
    view,
    focusCraftId:
      focusCraftId === undefined ? getRoom().focusCraftId : focusCraftId,
  });
}

export function setThreshold(threshold: number) {
  const t = Math.max(5, Math.min(95, Math.round(threshold)));
  patchRoom({
    salience: { ...getRoom().salience, threshold: t },
  });
}

export function toggleCraftOpen(craftId: string) {
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    crafts: s.crafts.map((c) =>
      c.id === craftId ? { ...c, open: !c.open } : { ...c, open: false },
    ),
    focusCraftId: craftId,
  }));
}

export function toggleVerb(verbId: string) {
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    verbs: s.verbs.map((v) =>
      v.id === verbId && v.gatedIssue == null ? { ...v, on: !v.on } : v,
    ),
  }));
}

export function setComposer(text: string) {
  patchRoom({ composerText: text });
}

/** Flip speaker-gate route between phone and Mac. */
export function toggleAudioRoute() {
  setAudioRoute(getRoom().audio.route === "phone" ? "mac" : "phone");
}

/** Pick a speaker explicitly — the segmented phone|mac toggle on LISTEN. */
export function setAudioRoute(next: "phone" | "mac") {
  const s = getRoom();
  if (s.audio.route === next) return;
  patchRoom({
    audio: {
      ...s.audio,
      route: next,
      gateCountdown: next === "phone" ? "04:58" : "—",
    },
  });
}

/** STOP playback — free by construction (clip already paid). */
export function stopPlayback() {
  stopSpeaking();
  patchRoom({ speakingPersona: null });
}

/** Mock text inject into the focused craft's tmux. */
export function injectReply(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  setRoom((s) => {
    const craftId =
      s.focusCraftId ??
      s.heldQuestion?.craftId ??
      s.crafts.find((c) => c.state === "needs-you")?.id ??
      s.crafts.find((c) => c.state !== "empty")?.id ??
      null;
    return {
      ...s,
      rev: s.rev + 1,
      composerText: "",
      transcript: [
        ...s.transcript,
        { who: "YOU" as const, text: trimmed, you: true },
      ],
      crafts: craftId
        ? mapCraft(s.crafts, craftId, (c) => ({
            ...c,
            tail: [
              ...c.tail,
              { kind: "cmd" as const, text: `inject · ${trimmed}` },
            ],
          }))
        : s.crafts,
    };
  });
}

/** Focus a craft for the ANSWER screen (field plot / row taps). */
export function focusCraftForAnswer(craftId: string) {
  setRoom((s) => ({
    ...s,
    rev: s.rev + 1,
    focusCraftId: craftId,
    crafts: s.crafts.map((c) => ({
      ...c,
      open: c.id === craftId,
    })),
  }));
}

/** Replay the last Mikey transcript line (free speechSynthesis). */
export function replayLastMikey() {
  const s = getRoom();
  const last = [...s.transcript].reverse().find((r) => r.who === "MIKEY");
  if (!last) return;
  speakMikey(last.text);
}

export type ScenarioTrigger = {
  id: string;
  label: string;
  danger?: boolean;
  run: () => void;
};

export const TRIGGERS: ScenarioTrigger[] = [
  { id: "spawn", label: "SPAWN CRAFT", run: spawnCraft },
  { id: "hand", label: "HAND RAISE (ARRIVAL)", run: () => handRaise() },
  { id: "held", label: "HELD QUESTION", run: () => heldQuestion() },
  { id: "answer", label: "ANSWER (KEYCAP)", run: () => answer("ship") },
  {
    id: "answer-speak",
    label: "ANSWER · SPEAK IT",
    run: () => answer("ship", true),
  },
  { id: "speak", label: "SPEAK (MIKEY)", run: speak },
  { id: "donnie-out", label: "DONNIE CHECKOUT", run: donnieCheckout },
  { id: "donnie-in", label: "THANKS DONNIE", run: thanksDonnie },
  { id: "live", label: "LIVE CLIP", run: liveClip },
  { id: "settle", label: "SETTLE CRAFT", run: () => settleCraft() },
  { id: "lull", label: "THE LULL", run: theLull },
  { id: "mic", label: "MIC OPEN", run: micOpen },
  { id: "mic-close", label: "MIC CLOSE", run: micClose },
  { id: "tapin", label: "TAP-IN Q&A", run: tapInQa },
  { id: "diagram", label: "DIAGRAM ARTIFACT", run: diagramArtifact },
  { id: "burn", label: "SPEND BURN", run: spendBurn },
  { id: "time", label: "TIME ×10", run: timeTimes10 },
  { id: "reset", label: "RESET", danger: true, run: reset },
];

/** Persona → speechSynthesis voice preference hint. */
export type { PersonaId };
