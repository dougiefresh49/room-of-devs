import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { roomShortLabel } from "../chrome/MastheadTabs";
import { coupleRoom, focusCraftForAnswer } from "../mock/scenario";
import { getRoom, useFleet, useRoom } from "../mock/store";
import type { ComposerTarget, RoomId } from "../mock/types";
import "../styles/field.css";
import { ComsComposerBar } from "./ComsComposerBar";
import { ComsScreen } from "./ComsScreen";
import { FieldHangar } from "./FieldHangar";
import { FieldPlaceSheet } from "./FieldPlaceSheet";
import { FieldScreensSheet } from "./FieldScreensSheet";
import { FieldSizePicker, readFieldHandsetSize } from "./FieldSizePicker";
import { FieldTopBar } from "./FieldTopBar";
import { FloorSheet } from "./FloorSheet";
import { GaugesScreen, hasHotGuard } from "./GaugesScreen";
import { GlanceScreen } from "./GlanceScreen";
import { NodeSheet } from "./NodeSheet";
import { OrdersScreen } from "./OrdersScreen";
import type { FieldBadge, FieldScreen } from "./types";
import { VoiceNoteSheet } from "./VoiceNoteSheet";

function verbSignature(room: ReturnType<typeof useRoom>): string {
  return room.verbs.map((verb) => `${verb.id}:${verb.on}`).join("|");
}

interface FieldSnapshot {
  roomId: RoomId;
  held: ReturnType<typeof useRoom>["heldQuestion"];
  tapInRev: number | null;
  spawns: string[];
  commission: ReturnType<typeof useFleet>["commission"];
  speaker: ReturnType<typeof useRoom>["speakingPersona"];
  crossRoomAlerts: string[];
  verbs: string;
}

type FieldEvent =
  | { type: "held-set"; craftId: string }
  | { type: "held-cleared" }
  | { type: "tap-in" }
  | { type: "spawn" }
  | { type: "commission-opened" }
  | { type: "speech" }
  | { type: "cross-room" }
  | { type: "orders-changed" };

interface PendingBadges {
  glance: boolean;
  coms: boolean;
  orders: boolean;
}

const NO_PENDING: PendingBadges = { glance: false, coms: false, orders: false };

function takeSnapshot(
  roomId: RoomId,
  room: ReturnType<typeof useRoom>,
  fleet: ReturnType<typeof useFleet>,
): FieldSnapshot {
  return {
    roomId,
    held: room.heldQuestion,
    tapInRev: room.tapIn?.startedRev ?? null,
    spawns: room.crafts
      .filter((craft) => craft.spawnedRev != null)
      .map((craft) => `${craft.id}:${craft.spawnedRev}`),
    commission: fleet.commission,
    speaker: room.speakingPersona,
    crossRoomAlerts: fleet.traffic
      .filter((row) => row.roomId !== roomId && row.belowGate)
      .map((row) => `${row.roomId}:${row.craftId ?? row.label}`),
    verbs: verbSignature(room),
  };
}

function eventsBetween(previous: FieldSnapshot | null, current: FieldSnapshot): FieldEvent[] {
  if (!previous) {
    return current.commission?.source === "voice" ? [{ type: "commission-opened" }] : [];
  }
  if (previous.roomId !== current.roomId) return [];

  const events: FieldEvent[] = [];
  if (current.held && current.held !== previous.held) {
    events.push({ type: "held-set", craftId: current.held.craftId });
  } else if (!current.held && previous.held) {
    events.push({ type: "held-cleared" });
  }
  if (current.tapInRev != null && current.tapInRev !== previous.tapInRev) {
    events.push({ type: "tap-in" });
  }
  const previousSpawns = new Set(previous.spawns);
  for (const spawn of current.spawns) {
    if (!previousSpawns.has(spawn)) events.push({ type: "spawn" });
  }
  if (!previous.commission && current.commission?.source === "voice") {
    events.push({ type: "commission-opened" });
  }
  if (current.speaker && current.speaker !== previous.speaker) {
    events.push({ type: "speech" });
  }
  const previousAlerts = new Set(previous.crossRoomAlerts);
  for (const alert of current.crossRoomAlerts) {
    if (!previousAlerts.has(alert)) events.push({ type: "cross-room" });
  }
  if (current.verbs !== previous.verbs) events.push({ type: "orders-changed" });
  return events;
}

export function FieldView({ bare = false }: { bare?: boolean }) {
  const room = useRoom();
  const fleet = useFleet();
  const roomId = fleet.activeRoomId;
  const [screens, setScreens] = useState<Partial<Record<RoomId, FieldScreen>>>({
    [roomId]: "glance",
  });
  const screen = screens[roomId] ?? "glance";
  const [sheetCraftId, setSheetCraftId] = useState<string | null>(null);
  const [hangarOpen, setHangarOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [replyTargetCraftId, setReplyTargetCraftId] = useState<string | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [screensOpen, setScreensOpen] = useState(false);
  const [handsetSize, setHandsetSize] = useState(readFieldHandsetSize);
  const [pendingByRoom, setPendingByRoom] = useState<Partial<Record<RoomId, PendingBadges>>>({});
  const heldCounter = useRef(1);
  const [heldKeys, setHeldKeys] = useState<Record<RoomId, string | null>>({
    [roomId]: room.heldQuestion ? `${roomId}:held:1` : null,
  });
  const [seenHeldKeys, setSeenHeldKeys] = useState<Set<string>>(() => new Set());
  const localOrderChange = useRef(false);
  const hangarHistory = useRef<{
    roomId: RoomId;
    screen: FieldScreen;
  } | null>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);
  const sheetCloseAction = useRef<(() => void) | null>(null);
  const restoreSheetFocus = useRef(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const setPending = useCallback(
    (targetRoomId: RoomId, target: keyof PendingBadges, value: boolean) => {
      setPendingByRoom((current) => ({
        ...current,
        [targetRoomId]: {
          ...(current[targetRoomId] ?? NO_PENDING),
          [target]: value,
        },
      }));
    },
    [],
  );

  const setScreen = useCallback(
    (next: FieldScreen) => {
      setScreens((current) => ({ ...current, [roomId]: next }));
      setComposerFocused(false);
      const reopensCurrentComposer = screen === "coms" && next === "coms";
      if (room.composerText.trim().length === 0 && !reopensCurrentComposer) {
        setReplyTargetCraftId(null);
      }
      if (next === "glance" || next === "coms" || next === "orders") {
        setPending(roomId, next, false);
      }
    },
    [room.composerText, roomId, screen, setPending],
  );

  const currentHeldKey = heldKeys[roomId] ?? null;
  const clearTargetIfIdle = useCallback(() => {
    if (getRoom().composerText.trim().length === 0) setReplyTargetCraftId(null);
  }, []);

  const markHeldSeen = useCallback(() => {
    if (!currentHeldKey) return;
    setSeenHeldKeys((current) => {
      if (current.has(currentHeldKey)) return current;
      const next = new Set(current);
      next.add(currentHeldKey);
      return next;
    });
  }, [currentHeldKey]);

  const openNode = useCallback(
    (craftId: string) => {
      if (hangarOpen) return;
      setScreensOpen(false);
      sheetOpener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      sheetCloseAction.current = null;
      restoreSheetFocus.current = true;
      focusCraftForAnswer(craftId);
      setSheetCraftId(craftId);
      setSheetOpen(true);
      if (room.heldQuestion?.craftId === craftId) markHeldSeen();
    },
    [hangarOpen, markHeldSeen, room.heldQuestion],
  );

  const enterHangar = useCallback(() => {
    if (!hangarOpen) hangarHistory.current = { roomId, screen };
    setScreensOpen(false);
    setComposerFocused(false);
    clearTargetIfIdle();
    setHangarOpen(true);
  }, [clearTargetIfIdle, hangarOpen, roomId, screen]);

  const openHangar = useCallback(() => {
    setScreensOpen(false);
    setComposerFocused(false);
    if (sheetCraftId) {
      sheetCloseAction.current = enterHangar;
      restoreSheetFocus.current = false;
      setSheetOpen(false);
      return;
    }
    enterHangar();
  }, [enterHangar, sheetCraftId]);

  useEffect(() => {
    const onDeckOpenHangar = () => openHangar();
    window.addEventListener("field:open-hangar", onDeckOpenHangar);
    return () => window.removeEventListener("field:open-hangar", onDeckOpenHangar);
  }, [openHangar]);

  const finishSheetClose = useCallback(() => {
    const action = sheetCloseAction.current;
    const opener = sheetOpener.current;
    const shouldRestoreFocus = restoreSheetFocus.current;
    sheetCloseAction.current = null;
    sheetOpener.current = null;
    restoreSheetFocus.current = true;
    setSheetCraftId(null);
    setSheetOpen(false);
    action?.();
    if (!action && shouldRestoreFocus && opener?.isConnected) {
      // Radix tears its focus scope down after the sheet content unmounts.
      // Restore on the following frame so that teardown cannot move focus
      // back to the document body after we have focused the opener.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => opener.focus());
      });
    }
  }, []);

  const closeNode = useCallback((afterClose?: () => void) => {
    sheetCloseAction.current = afterClose ?? null;
    restoreSheetFocus.current = true;
    setSheetOpen(false);
  }, []);

  const restoreFromHangar = useCallback(() => {
    const history = hangarHistory.current;
    if (history) {
      coupleRoom(history.roomId);
      setScreens((current) => ({ ...current, [history.roomId]: history.screen }));
    }
    setHangarOpen(false);
    setComposerFocused(false);
    clearTargetIfIdle();
  }, [clearTargetIfIdle]);

  const coupleFromField = useCallback((nextRoomId: RoomId) => {
    setSheetCraftId(null);
    setSheetOpen(false);
    setScreensOpen(false);
    setComposerFocused(false);
    setReplyTargetCraftId(null);
    coupleRoom(nextRoomId);
    setScreens((current) => ({ ...current, [nextRoomId]: "glance" }));
  }, []);

  const coupleFromHangar = useCallback((nextRoomId: RoomId) => {
    coupleRoom(nextRoomId);
    setScreens((current) => ({ ...current, [nextRoomId]: "glance" }));
    setHangarOpen(false);
    setSheetCraftId(null);
    setSheetOpen(false);
    setScreensOpen(false);
    setComposerFocused(false);
    setReplyTargetCraftId(null);
  }, []);

  const canAutoNavigate =
    !hangarOpen &&
    sheetCraftId == null &&
    !screensOpen &&
    !composerFocused &&
    room.composerText.trim().length === 0;

  const previous = useRef<FieldSnapshot | null>(null);

  useEffect(() => {
    const snapshot = takeSnapshot(roomId, room, fleet);
    const prior = previous.current;
    const events = eventsBetween(prior, snapshot);
    // Advance only after the complete transition has been decomposed. State
    // updates below may re-render, but can never consume a sibling event.
    previous.current = snapshot;

    if (prior && prior.roomId !== roomId) {
      if (room.heldQuestion && !heldKeys[roomId]) {
        const key = `${roomId}:held:${++heldCounter.current}`;
        setHeldKeys((current) => ({ ...current, [roomId]: key }));
      }
      return;
    }

    const takeoverReserved = events.some((event) => event.type === "commission-opened");
    let navigationAvailable = canAutoNavigate && !takeoverReserved;

    const routeTo = (target: "glance" | "coms" | "orders", navigate: () => void) => {
      if (navigationAvailable) {
        navigationAvailable = false;
        navigate();
      } else {
        setPending(roomId, target, true);
      }
    };

    for (const event of events) {
      switch (event.type) {
        case "held-set": {
          // Badge-only: the new unseen held key IS the red COMS badge. The
          // question sheet opens only from an explicit user tap (GLANCE node
          // or the in-flow held row) — never from the event pipeline.
          const key = `${roomId}:held:${++heldCounter.current}`;
          setHeldKeys((current) => ({ ...current, [roomId]: key }));
          break;
        }
        case "held-cleared":
          setHeldKeys((current) => ({ ...current, [roomId]: null }));
          break;
        case "tap-in":
        case "spawn":
          if (screen !== "coms") setPending(roomId, "coms", true);
          break;
        case "commission-opened":
          openHangar();
          break;
        case "speech":
          if (screen !== "coms") setPending(roomId, "coms", true);
          break;
        case "cross-room":
          routeTo("glance", () => setScreen("glance"));
          break;
        case "orders-changed":
          if (localOrderChange.current) localOrderChange.current = false;
          else routeTo("orders", () => setScreen("orders"));
          break;
      }
    }
  }, [canAutoNavigate, fleet, heldKeys, openHangar, room, roomId, screen, setPending, setScreen]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Close the topmost visible takeover before descending the ladder.
      if (sheetCraftId) {
        event.preventDefault();
        event.stopPropagation();
        closeNode();
      } else if (voiceOpen) {
        event.preventDefault();
        event.stopPropagation();
        setVoiceOpen(false);
      } else if (floorOpen) {
        event.preventDefault();
        event.stopPropagation();
        setFloorOpen(false);
      } else if (screensOpen) {
        event.preventDefault();
        event.stopPropagation();
        setScreensOpen(false);
      } else if (placeOpen) {
        event.preventDefault();
        event.stopPropagation();
        setPlaceOpen(false);
      } else if (hangarOpen) {
        event.preventDefault();
        event.stopPropagation();
        restoreFromHangar();
      }
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [
    closeNode,
    floorOpen,
    hangarOpen,
    placeOpen,
    restoreFromHangar,
    screensOpen,
    sheetCraftId,
    voiceOpen,
  ]);

  const unseenHeld = Boolean(
    room.heldQuestion && currentHeldKey && !seenHeldKeys.has(currentHeldKey),
  );
  const pending = pendingByRoom[roomId] ?? NO_PENDING;
  const badges = useMemo<Partial<Record<FieldScreen, FieldBadge>>>(() => {
    const next: Partial<Record<FieldScreen, FieldBadge>> = {};
    if (room.crafts.some((craft) => craft.state === "needs-you") || pending.glance) {
      next.glance = { tone: "red", label: "needs you" };
    }
    if (unseenHeld) next.coms = { tone: "red", label: "held question needs you" };
    else if (room.speakingPersona != null) {
      next.coms = { tone: "amber", pulse: true, label: "speaking" };
    } else if (pending.coms) next.coms = { tone: "amber", label: "new activity" };
    if (pending.orders) next.orders = { tone: "amber", label: "new order" };
    if (hasHotGuard(room.spend)) next.gauges = { tone: "red", label: "guard needs you" };
    return next;
  }, [pending, room.crafts, room.speakingPersona, room.spend, unseenHeld]);

  // Aggregate "something needs you" cue for the folded nav. Red > amber;
  // pulse only carries the real speaking fact (never invented).
  const aggregate = useMemo<FieldBadge | null>(() => {
    const values = Object.values(badges).filter((badge): badge is FieldBadge => badge != null);
    if (values.length === 0) return null;
    const reds = values.filter((badge) => badge.tone === "red");
    if (reds.length > 0) return { tone: "red", label: "a screen needs you" };
    const speaking = values.some((badge) => badge.pulse === true);
    return { tone: "amber", pulse: speaking, label: speaking ? "speaking" : "new activity" };
  }, [badges]);

  const targetCraftId = replyTargetCraftId ?? sheetCraftId;
  const targetCraft = targetCraftId
    ? (room.crafts.find((craft) => craft.id === targetCraftId) ?? null)
    : null;
  const composerTarget: ComposerTarget = targetCraft
    ? replyTargetCraftId === targetCraft.id || room.heldQuestion?.craftId === targetCraft.id
      ? { kind: "craft", craft: targetCraft }
      : { kind: "mikey-about", craft: targetCraft }
    : { kind: "mikey" };
  const historyRoom = hangarHistory.current?.roomId ?? roomId;
  const moodClass =
    room.mood === "mic-open"
      ? "mood-mic-open"
      : room.mood === "the-lull"
        ? "mood-the-lull"
        : room.mood === "arrival"
          ? "mood-arrival"
          : "";
  const anySheetOpen = sheetCraftId != null || placeOpen || floorOpen || voiceOpen || screensOpen;

  useLayoutEffect(() => {
    const screenElement = document.querySelector<HTMLElement>(".field-root .fscr");
    if (!screenElement) return;
    const setBounds = () => {
      const rect = screenElement.getBoundingClientRect();
      const root = document.documentElement;
      root.style.setProperty("--field-screen-left", `${rect.left}px`);
      root.style.setProperty("--field-screen-top", `${rect.top}px`);
      root.style.setProperty("--field-screen-width", `${rect.width}px`);
      root.style.setProperty("--field-screen-height", `${rect.height}px`);
      root.style.setProperty("--field-screen-bottom", `${window.innerHeight - rect.bottom}px`);
    };
    setBounds();
    const observer = "ResizeObserver" in window ? new ResizeObserver(setBounds) : null;
    observer?.observe(screenElement);
    window.addEventListener("resize", setBounds);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", setBounds);
    };
  }, [bare, handsetSize]);

  const screenBed = (
    <div className="screenbed fscr">
      <div className="inner">
        <FieldTopBar
          screen={screen}
          hangarOpen={hangarOpen}
          screensOpen={screensOpen}
          aggregate={aggregate}
          onOpenPlaces={() => {
            setScreensOpen(false);
            setPlaceOpen(true);
          }}
          onOpenScreens={() => setScreensOpen(true)}
          onOpenFloor={() => {
            setScreensOpen(false);
            setFloorOpen(true);
          }}
        />

        {hangarOpen ? (
          <FieldHangar
            returnLabel={roomShortLabel(historyRoom)}
            onBack={restoreFromHangar}
            onCouple={coupleFromHangar}
          />
        ) : screen === "glance" ? (
          <GlanceScreen onOpenNode={openNode} onCouple={coupleFromField} />
        ) : screen === "coms" ? (
          <ComsScreen onOpenNode={openNode} onOpenFloor={() => setFloorOpen(true)} />
        ) : screen === "orders" ? (
          <OrdersScreen
            onLocalChange={() => {
              localOrderChange.current = true;
            }}
          />
        ) : (
          <GaugesScreen />
        )}

        {anySheetOpen ? <span className="field-sheet-open" aria-hidden /> : null}
        {screen === "coms" && !hangarOpen ? (
          <ComsComposerBar
            target={composerTarget}
            focusSignal={composerFocusSignal}
            scrollOnFocus={bare}
            onFocusChange={setComposerFocused}
            onTargetConsumed={() => setReplyTargetCraftId(null)}
            onTargetDismissed={() => setReplyTargetCraftId(null)}
            onOpenVoice={() => {
              setScreensOpen(false);
              setVoiceOpen(true);
            }}
          />
        ) : null}

        <FieldPlaceSheet
          open={placeOpen}
          onOpenChange={setPlaceOpen}
          onCouple={coupleFromField}
          onOpenHangar={openHangar}
        />
        <FieldScreensSheet
          open={screensOpen}
          onOpenChange={setScreensOpen}
          screen={screen}
          badges={badges}
          onSelect={(next) => {
            if (hangarOpen) setHangarOpen(false);
            setScreen(next);
          }}
        />
        <FloorSheet open={floorOpen} onOpenChange={setFloorOpen} />
        <VoiceNoteSheet
          open={voiceOpen}
          onOpenChange={setVoiceOpen}
          onTypeInstead={() => {
            flushSync(() => {
              setVoiceOpen(false);
            });
            document.querySelector<HTMLTextAreaElement>(".field-root .fcomposer textarea")?.focus();
          }}
        />

        {sheetCraftId && !hangarOpen ? (
          <NodeSheet
            craftId={sheetCraftId}
            open={sheetOpen}
            onRequestClose={() => closeNode()}
            onAfterClose={finishSheetClose}
            onAnswered={() => {
              const answeredCraftId = sheetCraftId;
              closeNode(() => {
                setScreen("coms");
                setReplyTargetCraftId(answeredCraftId);
                setComposerFocusSignal((value) => value + 1);
              });
            }}
          />
        ) : null}
      </div>
    </div>
  );

  const fieldStyle = {
    "--fone-w": `${handsetSize.width}px`,
    "--fone-h": `${handsetSize.height}px`,
  } as CSSProperties;

  return (
    <div
      className={`field-root${bare ? " is-bare" : ""}${moodClass ? ` ${moodClass}` : ""}`}
      style={fieldStyle}
    >
      {!bare ? (
        <div className="field-mast">
          <div className="haz" style={{ marginBottom: 12 }} />
          <h1>
            THE <span>RIG</span>
            {" // FIELD UNIT"}
          </h1>
          <a className="back" href="/">
            ◂ RIG
          </a>
          <FieldSizePicker value={handsetSize} onChange={setHandsetSize} />
        </div>
      ) : null}

      {bare ? (
        screenBed
      ) : (
        <div className="fone">
          <span className="sidekey" />
          <span className="sidekey low" />
          {screenBed}
        </div>
      )}
    </div>
  );
}
