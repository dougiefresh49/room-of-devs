/**
 * RoomClient — the framework-free external store both UIs consume.
 *
 * Owns: connection state, the (epoch, rev)-gated snapshot, and grant
 * optimism. Everything else the server pushes (notices, legacy errors,
 * query replies, snap nudges, captured buttons) passes through onEvent so
 * the existing renderers keep their handlers during Phase 2; query replies
 * are additionally cached (getCachedQuery) so Phase-3 React islands that
 * mount late don't have to re-request data the room already has.
 *
 * The subscribe/getState pair is useSyncExternalStore-compatible: getState
 * returns the same object reference until something actually changes.
 */
import type {
  ButtonsEvent,
  Command,
  CommandResult,
  KnownDirsEvent,
  ListVoicesEvent,
  PanelSnapshot,
  ResumableEvent,
  ServerEvent,
  SettingsEvent,
  ShortcutsEvent,
} from "@room/protocol";
import { PROTOCOL_VERSION } from "@room/protocol";
import { NO_PENDING_GRANTS, PENDING_GRANT_MS, beginGrant, reduceGrants } from "./grant.js";
import { TransportError } from "./types.js";
import type { RoomClientOptions, RoomState, Transport } from "./types.js";

/** Query command type → the domain reply event that settles it. */
const QUERY_REPLY_TYPES = {
  list_resumable: "resumable",
  known_dirs: "known_dirs",
  get_buttons: "buttons",
  get_settings: "settings",
  list_voices: "list_voices",
  get_shortcuts: "shortcuts",
} as const;

type QueryCommandType = keyof typeof QUERY_REPLY_TYPES;
type QueryReplyType = (typeof QUERY_REPLY_TYPES)[QueryCommandType];

interface QueryReplyByType {
  resumable: ResumableEvent;
  known_dirs: KnownDirsEvent;
  buttons: ButtonsEvent;
  settings: SettingsEvent;
  list_voices: ListVoicesEvent;
  shortcuts: ShortcutsEvent;
}

const CACHEABLE_REPLY_TYPES = new Set<string>(Object.values(QUERY_REPLY_TYPES));

export class RoomClient {
  private state: RoomState = {
    connected: false,
    snapshot: null,
    pendingGrants: NO_PENDING_GRANTS,
    protocolMismatch: false,
  };
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(ev: ServerEvent) => void>();
  private unsubscribers: Array<() => void> = [];
  /**
   * Staleness gate. rev is daemon-global and monotonic; epoch identifies
   * the daemon boot (rev restarts with the process). Gate: changed epoch →
   * accept + reset the rev baseline; same epoch → require rev to advance.
   * Pre-epoch daemons (no epoch field) fall back to connection-scoped revs:
   * the baseline resets on every reconnect.
   */
  private lastRev = -Infinity;
  private lastEpoch: number | null = null;
  private resetRevOnNextFrame = false;
  private grantTimers = new Set<ReturnType<typeof setTimeout>>();
  private queryCache = new Map<QueryReplyType, ServerEvent>();
  private requestCounter = 0;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly source?: RoomClientOptions["source"];

  constructor(
    private transport: Transport,
    opts: RoomClientOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
    this.source = opts.source;
    this.unsubscribers.push(
      transport.onConnection((up) => {
        if (up) this.resetRevOnNextFrame = true;
        if (up !== this.state.connected) {
          this.setState({ ...this.state, connected: up });
        }
      }),
      transport.onEvent((ev) => this.handleEvent(ev)),
    );
  }

  /** Idempotent; transports ignore repeat starts. */
  start(): void {
    this.transport.start();
  }

  dispose(): void {
    for (const un of this.unsubscribers) un();
    this.unsubscribers = [];
    for (const timer of this.grantTimers) clearTimeout(timer);
    this.grantTimers.clear();
    this.listeners.clear();
    this.eventListeners.clear();
    this.transport.stop();
  }

  // --- store contract -----------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): RoomState => this.state;

  /** Non-snapshot server events (notices, errors, query replies, snap…). */
  onEvent(cb: (ev: ServerEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  // --- commands -----------------------------------------------------------

  /** Legacy fire-and-forget. Dropped (returns false) while disconnected. */
  send(cmd: Command): boolean {
    return this.transport.send(this.withSource(cmd));
  }

  /**
   * Correlated send — resolves with the server's CommandResult (ok =
   * accepted/dispatched, NOT completed). Rejects with TransportError.
   */
  request(cmd: Command, timeoutMs = this.requestTimeoutMs): Promise<CommandResult> {
    return this.transport.request(this.withSource(cmd), timeoutMs);
  }

  /**
   * Typed query — resolves with the domain reply event (also cached),
   * rejects on a failed CommandResult or transport error. The reply passes
   * through onEvent as well, so legacy handlers keep working.
   */
  query<T extends QueryCommandType>(
    type: T,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<QueryReplyByType[(typeof QUERY_REPLY_TYPES)[T]]> {
    const replyType = QUERY_REPLY_TYPES[type];
    const requestId = this.newRequestId();
    type Reply = QueryReplyByType[(typeof QUERY_REPLY_TYPES)[T]];

    return new Promise<Reply>((resolve, reject) => {
      let settled = false;
      const un = this.transport.onEvent((ev) => {
        if (settled || ev.type !== replyType) return;
        if ((ev as { requestId?: string }).requestId !== requestId) return;
        settled = true;
        un();
        resolve(ev as Reply);
      });
      this.transport
        .request({ ...this.withSource({ type } as Command), requestId }, timeoutMs)
        .then(
          (result) => {
            // ok=true: the domain reply settles the promise (it arrives
            // before the command_result); nothing to do here.
            if (!result.ok && !settled) {
              settled = true;
              un();
              reject(new Error(result.code ?? result.message ?? "query rejected"));
            }
          },
          (err: unknown) => {
            if (settled) return;
            settled = true;
            un();
            reject(err);
          },
        );
    });
  }

  /** Last reply seen for a query type (from query() or legacy sends). */
  getCachedQuery<T extends QueryReplyType>(type: T): QueryReplyByType[T] | null {
    return (this.queryCache.get(type) as QueryReplyByType[T] | undefined) ?? null;
  }

  /**
   * Grant with optimism: a per-session pending state shows immediately and
   * clears via grant.ts's conditions, a wall-clock belt timer, or dispatch
   * failure. Duplicate clicks while pending are ignored (single dispatch).
   */
  grant(sessionId: string, output?: "mac" | "phone"): void {
    if (this.state.pendingGrants.has(sessionId)) return;
    const cmd: Command = output
      ? { type: "grant", sessionId, output }
      : { type: "grant", sessionId };
    const pending = beginGrant(sessionId, this.state.snapshot, this.now());
    const next = new Map(this.state.pendingGrants);
    next.set(sessionId, pending);
    this.setState({ ...this.state, pendingGrants: next });
    this.armGrantTimer();
    this.request(cmd).then(
      (result) => {
        if (!result.ok) this.clearGrant(sessionId);
      },
      (err: unknown) => {
        // Never dispatched → roll back now; unknown outcome (timeout /
        // socket died mid-flight) → leave the 25s belt to decide.
        if (err instanceof TransportError && (err.kind === "down" || err.kind === "stopped")) {
          this.clearGrant(sessionId);
        }
      },
    );
  }

  // --- internals ----------------------------------------------------------

  private withSource(cmd: Command): Record<string, unknown> {
    return this.source ? { source: this.source, ...cmd } : { ...cmd };
  }

  private newRequestId(): string {
    const id = globalThis.crypto?.randomUUID?.();
    if (id) return id;
    this.requestCounter += 1;
    return `room-client-${Date.now().toString(36)}-${this.requestCounter}`;
  }

  private handleEvent(ev: ServerEvent): void {
    if (ev.type === "snapshot") {
      const { type: _type, ...snapshot } = ev;
      this.applySnapshot(snapshot as PanelSnapshot);
      return;
    }
    if (CACHEABLE_REPLY_TYPES.has(ev.type)) {
      this.queryCache.set(ev.type as QueryReplyType, ev);
    }
    for (const cb of this.eventListeners) cb(ev);
  }

  private applySnapshot(snapshot: PanelSnapshot): void {
    if (typeof snapshot.epoch === "number") {
      if (snapshot.epoch !== this.lastEpoch) {
        this.lastEpoch = snapshot.epoch;
        this.lastRev = -Infinity;
      }
    } else if (this.resetRevOnNextFrame) {
      this.lastRev = -Infinity;
    }
    this.resetRevOnNextFrame = false;
    if (typeof snapshot.rev === "number") {
      if (snapshot.rev <= this.lastRev) return; // stale/replayed frame
      this.lastRev = snapshot.rev;
    }
    const pendingGrants = reduceGrants(this.state.pendingGrants, snapshot, this.now());
    const protocolMismatch =
      typeof snapshot.protocolVersion === "number" && snapshot.protocolVersion !== PROTOCOL_VERSION;
    this.setState({ ...this.state, snapshot, pendingGrants, protocolMismatch });
  }

  private clearGrant(sessionId: string): void {
    if (!this.state.pendingGrants.has(sessionId)) return;
    const next = new Map(this.state.pendingGrants);
    next.delete(sessionId);
    this.setState({ ...this.state, pendingGrants: next });
  }

  /** Belt: prune expired pendings even when no snapshot arrives. */
  private armGrantTimer(): void {
    const timer = setTimeout(() => {
      this.grantTimers.delete(timer);
      const pendingGrants = reduceGrants(this.state.pendingGrants, this.state.snapshot, this.now());
      if (pendingGrants !== this.state.pendingGrants) {
        this.setState({ ...this.state, pendingGrants });
      }
    }, PENDING_GRANT_MS + 50);
    this.grantTimers.add(timer);
  }

  private setState(next: RoomState): void {
    this.state = next;
    for (const cb of this.listeners) cb();
  }
}
