import {
  parseServerEvent,
  isKnownServerEventType,
  type CommandResult,
  type ServerEvent,
} from "@room/protocol";
import { TransportError } from "./types.js";
import type { Transport } from "./types.js";

type PendingRequest = {
  controller: AbortController;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Same-origin mobile transport: SSE for events and POST for commands. */
export class SseTransport implements Transport {
  private source: EventSource | null = null;
  private stopped = false;
  private requestCounter = 0;
  private pending = new Set<PendingRequest>();
  private eventListeners = new Set<(ev: ServerEvent) => void>();
  private connectionListeners = new Set<(up: boolean) => void>();
  private readonly baseUrl: string;
  private readonly eventsPath: string;
  private readonly actionPath: string;

  constructor(opts: { baseUrl?: string; eventsPath?: string; actionPath?: string } = {}) {
    this.baseUrl = opts.baseUrl ?? "";
    this.eventsPath = opts.eventsPath ?? "/events";
    this.actionPath = opts.actionPath ?? "/action";
  }

  start(): void {
    if (this.source || this.stopped) return;
    const source = new EventSource(this.url(this.eventsPath));
    this.source = source;
    source.onopen = () => this.emitConnection(true);
    source.onerror = () => this.emitConnection(false);
    source.onmessage = (message) => this.handleMessage(message.data);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.source?.close();
    this.rejectPending(new TransportError("stopped", "SSE transport stopped"));
  }

  send(payload: Record<string, unknown>): boolean {
    if (!this.source || this.source.readyState === EventSource.CLOSED) return false;
    void fetch(this.url(this.actionPath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    return true;
  }

  request(payload: Record<string, unknown>, timeoutMs: number): Promise<CommandResult> {
    if (this.stopped) return Promise.reject(new TransportError("stopped", "SSE transport stopped"));
    const requestId =
      typeof payload.requestId === "string" ? payload.requestId : this.newRequestId();
    const controller = new AbortController();

    return new Promise<CommandResult>((resolve, reject) => {
      const pending: PendingRequest = {
        controller,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(pending);
          controller.abort();
          reject(new TransportError("timeout", "SSE request timed out"));
        }, timeoutMs),
      };
      this.pending.add(pending);

      void fetch(this.url(this.actionPath), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await this.jsonBody(response);
          if (!this.pending.delete(pending)) return;
          clearTimeout(pending.timer);
          resolve(this.toCommandResult(requestId, body));
        })
        .catch(() => {
          if (!this.pending.delete(pending)) return;
          clearTimeout(pending.timer);
          // No response ⇒ almost certainly never reached the daemon; mobile's
          // old postAction rolled optimism back on this, so mark it "down".
          reject(new TransportError("down", "POST /action failed"));
        });
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

  private handleMessage(data: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    if (raw && typeof raw === "object" && !("type" in raw)) {
      raw = { type: "snapshot", ...raw };
    }
    const event = parseServerEvent(raw);
    if (!event) {
      const type =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as { type?: unknown }).type
          : undefined;
      if (isKnownServerEventType(type)) {
        console.warn(`[sse-transport] malformed ${type} frame dropped`);
      }
      return;
    }
    for (const cb of this.eventListeners) cb(event);
  }

  private async jsonBody(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private toCommandResult(requestId: string, body: unknown): CommandResult {
    const value =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const status = typeof value.status === "string" ? value.status : undefined;
    const ok = typeof value.ok === "boolean" ? value.ok : status === "ok";
    const result: CommandResult = { type: "command_result", requestId, ok };
    if (status && status !== "ok") result.code = status;
    if (typeof value.error === "string") result.message = value.error;
    if (typeof value.code === "string") result.code = value.code;
    if (typeof value.message === "string") result.message = value.message;
    return result;
  }

  private rejectPending(reason: Error): void {
    for (const pending of this.pending) {
      clearTimeout(pending.timer);
      pending.controller.abort();
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private emitConnection(up: boolean): void {
    for (const cb of this.connectionListeners) cb(up);
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private newRequestId(): string {
    const id = globalThis.crypto?.randomUUID?.();
    if (id) return id;
    this.requestCounter += 1;
    return `request-${Date.now().toString(36)}-${this.requestCounter}`;
  }
}
