/**
 * Call view (spec §B2) — the Sesame-style isolated call screen shown while a
 * session is live. Layout: name chip pinned top-center (mini avatar + name +
 * "live · N clips" credits chip) · presence avatar centered upper-third
 * (~120px, ring animates by mode) · ONE content card (precedence
 * speaking > final-landed > working > idle) · bottom dock (End-live left ·
 * live timer center · Send-a-text right). NOTHING else — no transport, no
 * output/broadcast buttons.
 *
 * The single <audio> keeps playing across the slide to chat; this view only
 * renders controls + reads the controller snapshot.
 */
import type { AgentView, NowPlaying } from "@room/protocol";
import type { PlayerSnapshot } from "../audio/controller.js";
import { usePlayer } from "../audio/react.js";
import type { ThreadItem } from "../api.js";
import { lastFinalTextSince } from "../thread.js";
import { IconMessage, IconPhoneOff, IconSpeaker, IconSpeakerOff } from "../icons.js";
import { Avatar } from "./Avatar.js";
import { KaraokeLine } from "./KaraokeLine.js";

type CardMode = "speaking" | "final" | "working" | "idle";

interface CardState {
  mode: CardMode;
  tag: string;
  tagClass: string;
  ringClass: string;
}

/** A phone-routed FINAL clip that's active but not yet audibly playing here. */
function isFreshPhoneFinal(
  np: NowPlaying | null,
  sessionId: string,
  speakingHere: boolean,
  player: PlayerSnapshot,
): boolean {
  if (!np || np.sessionId !== sessionId) return false;
  if (np.kind === "live" || np.output !== "phone" || np.endedAt || !np.text) return false;
  if (speakingHere) return false;
  // Loading / pending-tap / idle / paused = the final has landed but this phone
  // isn't audibly playing it yet.
  return (
    player.status === "loading" ||
    player.status === "pending-tap" ||
    player.status === "idle" ||
    player.status === "paused"
  );
}

interface CallViewProps {
  agent: AgentView;
  nowPlaying: NowPlaying | null;
  items: ThreadItem[];
  liveClips: number;
  ackFlash: boolean;
  elapsed: string;
  /** Call-timer origin (ms) — the "final landed" content is scoped to it. */
  liveStartedAt: number | null;
  /** A set_live transition is in flight — disable End-live. */
  liveBusy: boolean;
  liveMuted: boolean;
  muteBusy: boolean;
  injectable: boolean;
  onEndLive: () => void;
  onToggleMute: () => void;
  onSendText: () => void;
}

export function CallView({
  agent,
  nowPlaying,
  items,
  liveClips,
  ackFlash,
  elapsed,
  liveStartedAt,
  liveBusy,
  liveMuted,
  muteBusy,
  injectable,
  onEndLive,
  onToggleMute,
  onSendText,
}: CallViewProps) {
  // The 80ms karaoke tick is subscribed HERE (a leaf), so it never re-renders
  // the whole sheet — the chat thread/markdown stay off the playback tick.
  const player: PlayerSnapshot = usePlayer();
  const name = agent.label || agent.name;
  const speakingHere = player.status === "playing" && player.entry?.sessionId === agent.sessionId;
  const isLiveClip = nowPlaying?.kind === "live";
  const working = !speakingHere && agent.state === "working";
  const pending =
    !speakingHere &&
    !working &&
    isFreshPhoneFinal(nowPlaying, agent.sessionId, speakingHere, player);
  const activity = agent.live?.lastActivity;
  const tools = agent.live?.toolCount ?? 0;
  // Bug 3: only a final that landed DURING this call may fill the resting card
  // — never an hours-old pre-call final from the thread history.
  const done = lastFinalTextSince(items, liveStartedAt);

  const card: CardState = speakingHere
    ? {
        mode: "speaking",
        tag: isLiveClip ? "Speaking" : "Final",
        tagClass: "text-accent",
        ringClass: isLiveClip ? "" : "is-final",
      }
    : pending
      ? { mode: "final", tag: "Final", tagClass: "text-accent", ringClass: "is-final" }
      : working
        ? {
            mode: "working",
            tag: liveMuted ? "Watching" : "Working",
            tagClass: liveMuted ? "text-fg-muted" : "text-state-working",
            ringClass: liveMuted ? "" : "is-working",
          }
        : {
            mode: "idle",
            tag: liveMuted ? "Watching" : "Done",
            tagClass: "text-fg-muted",
            ringClass: done ? "is-final" : "",
          };

  return (
    <div
      className="flex h-full flex-col bg-bg"
      style={{
        background:
          "radial-gradient(ellipse at 50% 26%, color-mix(in srgb, var(--room-accent) 9%, var(--room-bg)) 0%, var(--room-bg) 58%)",
      }}
    >
      {/* name chip + credits */}
      <div className="flex shrink-0 flex-col items-center gap-4 px-4 pt-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-bg-elevated/80 py-1.5 pl-1.5 pr-3 backdrop-blur">
          <Avatar
            agent={agent}
            frame="idle"
            className="grid size-6 place-items-center overflow-hidden rounded-md bg-surface-strong text-[10px] font-semibold text-fg-muted"
          />
          <strong className="text-[13px] font-bold text-fg">{name}</strong>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
            live · {liveClips} clip{liveClips === 1 ? "" : "s"}
          </span>
        </div>

        {/* presence avatar */}
        <div
          className={`cv-presence mt-3 size-[120px] overflow-hidden rounded-[28px] ${card.ringClass}`}
        >
          <Avatar
            agent={agent}
            frame={speakingHere ? "speaking" : "idle"}
            className="grid size-full place-items-center bg-surface-strong text-2xl font-semibold text-fg-muted"
          />
        </div>
      </div>

      {/* content card — height-capped within the call layout so a long final
          scrolls INSIDE the card and never covers the avatar or the dock. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-4">
        <div
          key={card.mode}
          className="cv-card-in flex max-h-full w-full max-w-sm flex-col rounded-2xl border border-line bg-surface p-4"
        >
          <div
            className={`mb-2 shrink-0 text-[11px] font-bold uppercase tracking-wider ${card.tagClass}`}
          >
            {card.tag}
          </div>
          {card.mode === "speaking" ? (
            <div className="min-h-0 overflow-y-auto">
              <KaraokeLine
                text={player.text}
                alignment={player.alignment}
                elapsedMs={player.elapsedMs}
                variant="card"
                dim={isLiveClip}
              />
            </div>
          ) : card.mode === "final" ? (
            <div className="flex min-h-0 flex-col text-[15px] leading-relaxed text-fg">
              <div className="min-h-0 overflow-y-auto">{nowPlaying?.text || done || "…"}</div>
              <div className="mt-2 shrink-0 text-[12px] text-fg-muted">auto-playing…</div>
            </div>
          ) : card.mode === "working" ? (
            <div className="min-h-0 overflow-y-auto text-[15px] leading-relaxed text-fg">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate">{activity?.label || (liveMuted ? "watching" : "working")}</span>
                <span className="cv-dots shrink-0 text-accent" aria-hidden="true">
                  <i>.</i>
                  <i>.</i>
                  <i>.</i>
                </span>
              </div>
              <div className="mt-2 text-[12px] text-fg-muted">
                {liveMuted
                  ? "audio off · text only"
                  : ackFlash
                    ? "🔊 acknowledged"
                    : tools
                      ? `${tools} tool${tools === 1 ? "" : "s"} so far`
                      : "listening in…"}
              </div>
            </div>
          ) : (
            <div className="min-h-0 overflow-y-auto text-[15px] leading-relaxed text-fg">
              {liveMuted ? (
                <div>
                  <div>{activity?.label || "watching"}</div>
                  <div className="mt-2 text-[12px] text-fg-muted">audio off · text only</div>
                </div>
              ) : done ? (
                done
              ) : (
                <span className="text-fg-muted">Listening…</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* dock: End · timer · mute · Send a text (injectable only) */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:px-8">
        <button
          type="button"
          onClick={onEndLive}
          disabled={liveBusy}
          aria-disabled={liveBusy}
          aria-label="End live"
          className="grid size-14 shrink-0 place-items-center rounded-full bg-danger text-white shadow-lg shadow-danger/30 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-60 [&_svg]:size-6"
        >
          <IconPhoneOff />
        </button>

        <div className="min-w-0 flex-1 text-center">
          <div className="text-[15px] font-semibold tabular-nums text-fg">{elapsed}</div>
          <div className="text-[11px] text-fg-muted">{liveMuted ? "watching" : "live"}</div>
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          disabled={muteBusy}
          aria-disabled={muteBusy}
          aria-label={liveMuted ? "Unmute live narration" : "Mute live narration"}
          className="grid size-14 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-fg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 [&_svg]:size-[22px]"
        >
          {liveMuted ? <IconSpeakerOff /> : <IconSpeaker />}
        </button>

        {/* injectable → compose a reply; sdk → just view the live text thread
            (no reply until Phase B). Both slide back to the chat surface. */}
        <button
          type="button"
          onClick={onSendText}
          aria-label={injectable ? "Send a text" : "Show conversation text"}
          className="grid size-14 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-fg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-[22px]"
        >
          <IconMessage />
        </button>
      </div>
    </div>
  );
}
