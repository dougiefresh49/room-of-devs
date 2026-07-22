import ReconnectingWebSocket from "reconnecting-websocket";
import { parseServerEvent, type CommandResult, type ServerEvent } from "@room/protocol";
import { TransportError } from "./types.js";
import type { Transport } from "./types.js";

type PendingRequest = {
  resolve: (result: CommandResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Guaranteed-refused address (port 9, discard). reconnecting-websocket's
 * connect path has NO rejection handler for async url providers — a
 * provider that throws leaves `_connectLock` set and permanently wedges
 * reconnection. So the provider we hand it must never reject: on token
 * fetch failure (daemon down → panel's ws_token invoke rejects) we return
 * the last known URL, or this fast-fail address so the socket errors and
 * the library's own retry loop stays alive.
 */
const FAST_FAIL_URL = "ws://127.0.0.1:9/";

/** Loopback panel transport. Sends while disconnected are deliberately dropped. */
export class WsTransport implements Transport {
  private socket: ReconnectingWebSocket | null = null;
  private stopped = false;
  private requestCounter = 0;
  private lastUrl: string | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Set<(ev: ServerEvent) => void>();
  private connectionListeners = new Set<(up: boolean) => void>();

  constructor(
    private readonly urlProvider: () => Promise<string>,
    private readonly opts: { WebSocket?: unknown } = {},
  ) {}

  private safeUrlProvider = async (): Promise<string> => {
    try {
      const url = await this.urlProvider();
      this.lastUrl = url;
      return url;
    } catch {
      return this.lastUrl ?? FAST_FAIL_URL;
    }
  };

  start(): void {
    if (this.socket || this.stopped) return;
    this.socket = new ReconnectingWebSocket(this.safeUrlProvider, undefined, {
      WebSocket: this.opts.WebSocket,
      startClosed: true,
      maxEnqueuedMessages: 0,
      minReconnectionDelay: 500 + Math.random() * 500,
      maxReconnectionDelay: 10_000,
      reconnectionDelayGrowFactor: 1.5,
      connectionTimeout: 4_000,
    });
    this.socket.onopen = () => this.emitConnection(true);
    this.socket.onclose = () => {
      this.emitConnection(false);
      // Outcome unknown: an in-flight command may have landed before the
      // socket died. Callers treat "closed" as unknown, not failure.
      this.rejectPending(new TransportError("closed", "WebSocket connection closed"));
    };
    this.socket.onmessage = (message) => this.handleMessage(message.data);
    this.socket.reconnect();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.rejectPending(new TransportError("stopped", "WebSocket transport stopped"));
    this.socket?.close();
  }

  send(payload: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== ReconnectingWebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  request(payload: Record<string, unknown>, timeoutMs: number): Promise<CommandResult> {
    // Respect a caller-supplied requestId (RoomClient.query correlates the
    // domain reply frame by it); generate one otherwise.
    const requestId =
      typeof payload.requestId === "string" && payload.requestId
        ? payload.requestId
        : this.newRequestId();
    const envelope = { ...payload, requestId };

    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new TransportError("timeout", "WebSocket request timed out"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });

      if (!this.send(envelope)) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new TransportError("down", "WebSocket connection is down"));
        return;
      }

    });
  }

  onEvent(cb: (ev: ServerEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  onConnection(cb: (up: boolean) => void): () => void {
    this.connectionListeners.add(cb);
    return () => this.connectionListeners.delete(cb);
  }

  private handleMessage(data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    const event = parseServerEvent(raw);
    if (!event) return;

    if (event.type === "command_result") this.resolvePending(event);
    // Command results remain observable for legacy panel handlers.
    for (const cb of this.eventListeners) cb(event);
  }

  private resolvePending(result: CommandResult): void {
    const pending = this.pending.get(result.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(result.requestId);
    pending.resolve(result);
  }

  private rejectPending(reason: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private emitConnection(up: boolean): void {
    for (const cb of this.connectionListeners) cb(up);
  }

  private newRequestId(): string {
    const id = globalThis.crypto?.randomUUID?.();
    if (id) return id;
    this.requestCounter += 1;
    return `request-${Date.now().toString(36)}-${this.requestCounter}`;
  }
}
