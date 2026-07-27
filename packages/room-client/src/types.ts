/**
 * Shared shapes for the room-client package: the store's state, the
 * transport seam, and command-sending contracts.
 */
import type {
  Command,
  CommandResult,
  CommandSource,
  PanelSnapshot,
  ServerEvent,
} from "@room/protocol";
import type { PendingGrants } from "./grant.js";

export interface RoomState {
  /** Transport link is up (WS open / SSE connected). */
  connected: boolean;
  /** Last applied snapshot ((epoch, rev)-gated). Kept across disconnects so
   *  UIs can render the last-known room greyed out. */
  snapshot: PanelSnapshot | null;
  /** Optimistic grants in flight, keyed by sessionId (see grant.ts). */
  pendingGrants: PendingGrants;
  /**
   * True when the last applied snapshot carried a protocolVersion that
   * disagrees with this client's PROTOCOL_VERSION. Absent version (old
   * daemon) is not a mismatch — additive rollout.
   */
  protocolMismatch: boolean;
}

/**
 * Typed transport failure. `kind` tells callers whether the command
 * definitely never dispatched ("down", "stopped") or its outcome is unknown
 * ("timeout", "closed" — it may have reached the daemon). Grant optimism
 * clears on the former and leaves the 25s belt to cover the latter.
 */
export class TransportError extends Error {
  constructor(
    readonly kind: "down" | "timeout" | "stopped" | "closed",
    message: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/**
 * A transport delivers server events upward and carries commands downward.
 * Two implementations: WsTransport (desktop, loopback) and SseTransport
 * (mobile, LAN SSE + POST /action). RoomClient owns rev gating and state;
 * transports are dumb pipes plus connection lifecycle.
 */
export interface Transport {
  start(): void;
  /** Permanent stop — no reconnects after this. */
  stop(): void;
  /**
   * Fire-and-forget send. Returns false when the link is down (messages
   * are NOT queued — parity with the old panel's drop-when-closed send).
   */
  send(payload: Record<string, unknown>): boolean;
  /**
   * Send expecting a correlated CommandResult. WS: requestId round-trip.
   * SSE/HTTP: POST /action, result synthesized from the HTTP response.
   * Rejects on timeout, transport stop, or connection loss.
   */
  request(payload: Record<string, unknown>, timeoutMs: number): Promise<CommandResult>;
  /** Server events (snapshots included). Unknown kinds are already dropped. */
  onEvent(cb: (ev: ServerEvent) => void): () => void;
  /** Connection state edges. Fired with true on every (re)connect. */
  onConnection(cb: (up: boolean) => void): () => void;
}

export interface RoomClientOptions {
  /** Stamped onto every command envelope. */
  source?: CommandSource;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Default request() timeout. */
  requestTimeoutMs?: number;
}

export type { Command, CommandResult, PanelSnapshot, ServerEvent };
