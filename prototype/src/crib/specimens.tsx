import type { ReactNode } from "react";
import {
  AgentChips,
  Bay,
  Button,
  Chassis,
  CrtFace,
  CutFrame,
  DialGauge,
  FailedCountBadge,
  GrantButton,
  HexLayer,
  Keycap,
  Led,
  LiveBadge,
  Markdown,
  Odometer,
  Popover,
  PopoverContent,
  PopoverTrigger,
  QueuedPreview,
  SalienceBar,
  ScreenBed,
  StateBadge,
  SummaryText,
  Tag,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TransportBar,
  Waveform,
  IconPlay,
} from "@room/ui";
import { FieldCard } from "../rig-ext/FieldCard";
import { FieldCrtFace } from "../rig-ext/FieldCrtFace";
import { SessionDial } from "../rig-ext/SessionDial";

function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Card platen — one representative fixture per instrument. */
export function InstrumentPlaten({ name }: { name: string }): ReactNode {
  const motion = !reducedMotion();
  switch (name) {
    case "CutFrame":
      return (
        <CutFrame scale="s" glow="0 0 8px rgba(255,160,40,.35)">
          <div className="crib-cut-mini" />
        </CutFrame>
      );
    case "Chassis":
      return <Chassis className="crib-chassis-mini">CHASSIS</Chassis>;
    case "Bay":
      return (
        <Bay label="BAY">
          <span className="tag">INNER</span>
        </Bay>
      );
    case "ScreenBed":
      return <ScreenBed className="crib-screen-mini">PHOSPHOR</ScreenBed>;
    case "Tag":
      return (
        <>
          <Tag>WORKING</Tag> <Tag tone="red">NEEDS YOU</Tag>
        </>
      );
    case "Waveform":
      return <Waveform active={motion} bars={10} />;
    case "Led":
      return (
        <>
          <Led tone="green" /> <Led tone="amber" pulse={motion} />{" "}
          <Led tone="red" pulse={motion} pulseSpeed="hot" /> <Led tone="dim" />
        </>
      );
    case "Keycap":
      return (
        <>
          <Keycap glyph="1" label="OPT 1" /> <Keycap glyph="2" label="OPT 2" armed />
        </>
      );
    case "HexLayer":
      return <HexLayer intensity="dim" className="crib-hex-mini" />;
    case "Odometer":
      return <Odometer value={41927} digits={6} />;
    case "DialGauge":
      return <DialGauge fraction={0.58} caption="0.58" />;
    case "CrtFace":
      return (
        <CrtFace size={52}>
          <span className="crib-face-dot" />
        </CrtFace>
      );
    case "SalienceBar":
      return <SalienceBar lit={9} threshold={5} />;
    case "button":
      return (
        <div className="crib-btn-row">
          <Button variant="default" size="sm">
            PRIMARY
          </Button>
          <Button variant="outline" size="sm">
            OUTLINE
          </Button>
        </div>
      );
    case "dialog":
      return <span className="crib-mono-hint">RADIX DIALOG SHELL</span>;
    case "command":
      return <span className="crib-mono-hint">⌘ PALETTE · CMDK</span>;
    case "dropdown-menu":
      return <span className="crib-mono-hint">⋯ MENU</span>;
    case "popover":
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="crib-pop-trigger">
              POP
            </button>
          </PopoverTrigger>
          <PopoverContent className="crib-pop-content">anchored</PopoverContent>
        </Popover>
      );
    case "sheet":
      return <div className="crib-sheet-mini" />;
    case "toggle-group":
      return (
        <ToggleGroup type="single" defaultValue="a" className="crib-toggle-mini">
          <ToggleGroupItem value="a">A</ToggleGroupItem>
          <ToggleGroupItem value="b">B</ToggleGroupItem>
        </ToggleGroup>
      );
    case "tooltip":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="crib-pop-trigger">
                HOVER
              </button>
            </TooltipTrigger>
            <TooltipContent>A hint nobody renders — yet</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "toast":
      return <div className="crib-toast-mini">MANIFEST CHECKED IN</div>;
    case "StateBadge":
      return (
        <>
          <StateBadge state="working" /> <StateBadge state="hand_raised" />
        </>
      );
    case "AgentChips":
      return <AgentChips raised raisedCount={2} supersededCount={0} onPhone={false} />;
    case "LiveBadge":
      return (
        <LiveBadge
          live={{
            on: true,
            toolCount: 2,
            turnStartedAt: null,
            lastActivity: { label: "tail", at: "2026-08-02T00:00:00Z" },
          }}
        />
      );
    case "FailedCountBadge":
      return <FailedCountBadge count={3} />;
    case "QueuedPreview":
      return <QueuedPreview text="the grant now expires at the lull…" />;
    case "GrantButton":
      return <GrantButton label="GRANT" onGrant={() => {}} />;
    case "TransportBar":
      return (
        <TransportBar
          paused={false}
          held={false}
          onPause={() => {}}
          onStop={() => {}}
          onReplay={() => {}}
          onHold={() => {}}
        />
      );
    case "SummaryText":
      return <SummaryText text="**Settled** — replay queued." linkPolicy="inert" />;
    case "Markdown":
      return (
        <Markdown
          text="## Settled\nthe `grant` now expires\n[docs](https://example.com)"
          linkPolicy="inert"
          className="crib-md-mini"
        />
      );
    case "icons":
      return (
        <span className="crib-icon-wrap">
          <IconPlay />
        </span>
      );
    case "FieldCard":
      return (
        <FieldCard>
          <span className="tag">FIELD CARD</span>
        </FieldCard>
      );
    case "FieldCrtFace":
      return (
        <FieldCrtFace size={40}>
          <span className="crib-face-dot" />
        </FieldCrtFace>
      );
    case "SessionDial":
      return <SessionDial fraction={0.55} sessionFraction={0.3} caption="WINDOW" />;
    default:
      return <span className="crib-mono-hint">{name}</span>;
  }
}

/** Spec plate state rack — fixed fixtures shown at once (§1.6). */
export function StateRack({ name }: { name: string }): ReactNode {
  const motion = !reducedMotion();
  switch (name) {
    case "DialGauge":
      return (
        <div className="crib-staterack">
          <div className="crib-state-slot">
            <DialGauge fraction={0.42} caption="0.42" />
            <span className="crib-state-label">0.42</span>
          </div>
          <div className="crib-state-slot">
            <DialGauge fraction={0.91} redlineFrom={0.85} caption="REDLINE" />
            <span className="crib-state-label">REDLINE</span>
          </div>
          <div className="crib-state-slot">
            <SessionDial fraction={0.7} sessionFraction={0.35} />
            <span className="crib-state-label">+ SESSION</span>
          </div>
          <div className="crib-state-slot">
            <DialGauge fraction={0} caption="COLD" />
            <span className="crib-state-label">COLD</span>
          </div>
        </div>
      );
    case "Led":
      return (
        <div className="crib-staterack crib-staterack--inline">
          <Led tone="green" title="green" />
          <Led tone="amber" pulse={motion} title="amber pulse" />
          <Led tone="red" pulse={motion} pulseSpeed="hot" title="red hot" />
          <Led tone="dim" title="dim" />
        </div>
      );
    case "Waveform":
      return (
        <div className="crib-staterack crib-staterack--inline">
          <Waveform active={motion} />
          <Waveform active={false} />
        </div>
      );
    case "Tag":
      return (
        <div className="crib-staterack crib-staterack--inline">
          <Tag>DEFAULT</Tag>
          <Tag tone="red">RED</Tag>
          <Tag tone="green">GREEN</Tag>
          <Tag tone="dim">DIM</Tag>
        </div>
      );
    case "button":
      return (
        <div className="crib-staterack crib-staterack--inline">
          <Button size="sm">DEFAULT</Button>
          <Button size="sm" variant="outline">
            OUTLINE
          </Button>
          <Button size="sm" variant="ghost">
            GHOST
          </Button>
          <Button size="sm" variant="destructive">
            DESTRUCTIVE
          </Button>
        </div>
      );
    default:
      return (
        <div className="crib-staterack">
          <div className="crib-state-slot crib-state-slot--wide">
            <InstrumentPlaten name={name} />
          </div>
        </div>
      );
  }
}
