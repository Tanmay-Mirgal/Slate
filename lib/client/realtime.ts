import {
  HEARTBEAT_TIMEOUT_MS,
  type ClientMessage,
  type DeniedReason,
  type PeerWire,
  type PresenceState,
  type ServerMessage,
  type SessionInfo,
  type WireOp,
} from "@/lib/realtime/protocol";

/**
 * The browser end of the realtime socket (`lib/realtime/server.ts`): one board, one WebSocket.
 * It reconnects on its own (backoff, and straight away when the network returns), re-joins with the
 * caller's fresh sign-in token, and tells its listeners when it is live so the page can fall back to
 * plain HTTP polling in between. Nothing here depends on React.
 */

export type SocketStatus = "idle" | "connecting" | "open" | "closed";

export interface SocketInfo {
  access: "edit" | "view";
  /** The server pushes comment / settings changes, so those need not be polled. */
  nudges: boolean;
}

export interface SocketHandlers {
  status(status: SocketStatus, info: SocketInfo | null): void;
  /** The reply to a join or sync request. */
  sync(msg: Extract<ServerMessage, { t: "sync" }>): void;
  /** A change pushed by the server. */
  elements(msg: Extract<ServerMessage, { t: "elements" }>): void;
  /** Everybody else on the board, whenever it changes. */
  peers(peers: PeerWire[]): void;
  access(level: "edit" | "view"): void;
  revoked(): void;
  denied(reason: DeniedReason, message: string): void;
  nudge(topic: "comments" | "slate"): void;
}

export interface BoardSocketOptions {
  url: string;
  slateId: string;
  session: SessionInfo;
  /** The signed-in user's session token (null when signed out). */
  getToken: () => Promise<string | null>;
  WebSocketImpl?: typeof WebSocket;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Reconnect when the server has been silent this long (it sends a heartbeat every 20 s). */
  silenceMs?: number;
  /** Give up on a connection attempt (open + join) that has not completed after this long and try again. */
  connectTimeoutMs?: number;
}

/** The connection dropped or timed out before the server answered: the request may be retried elsewhere (HTTP). */
export class ConnectionLostError extends Error {
  constructor(message = "The live connection was lost.") {
    super(message);
    this.name = "ConnectionLostError";
  }
}

interface Pending {
  resolve: (r: { applied: number }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const OPS_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 10_000;

/** Where the realtime server is, or null when this deployment has none (the page then polls over HTTP). */
export function realtimeUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (configured === "off") return null;
  if (configured) {
    const base = configured.replace(/\/+$/, "");
    return base.endsWith("/ws") ? base : `${base}/ws`;
  }
  if (typeof window === "undefined") return null;
  const { protocol, hostname } = window.location;
  // local development: `npm run dev` starts the realtime server next to the app
  if (hostname === "localhost" || hostname === "127.0.0.1") return `${protocol === "https:" ? "wss" : "ws"}://${hostname}:4000/ws`;
  return null;
}

export class BoardSocket {
  status: SocketStatus = "idle";
  info: SocketInfo | null = null;
  /** Where a (re)join should catch up from. Set by whoever holds the board's rows. */
  private sinceProvider: () => number = () => 0;

  private ws: WebSocket | null = null;
  private listeners = new Set<Partial<SocketHandlers>>();
  private peerMap = new Map<string, PeerWire>();
  private pending = new Map<number, Pending>();
  private nextOpId = 1;
  private attempt = 0;
  private authRetries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeard = 0;
  private stopped = true;
  private session: SessionInfo;
  private cleanupWindow: (() => void) | null = null;

  constructor(private readonly opts: BoardSocketOptions) {
    this.session = opts.session;
  }

  /* ------------------------------------------------------------------ public API */

  get isOpen() {
    return this.status === "open";
  }

  peers(): PeerWire[] {
    return Array.from(this.peerMap.values());
  }

  subscribe(handlers: Partial<SocketHandlers>): () => void {
    this.listeners.add(handlers);
    return () => void this.listeners.delete(handlers);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    if (typeof window !== "undefined") {
      const again = () => {
        if (!this.stopped && this.status !== "open" && this.status !== "connecting") this.connectNow();
      };
      window.addEventListener("online", again);
      this.cleanupWindow = () => window.removeEventListener("online", again);
    }
    this.connectNow();
  }

  stop() {
    this.stopped = true;
    this.cleanupWindow?.();
    this.cleanupWindow = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.closeSocket();
    this.setStatus("idle", null);
  }

  setSinceProvider(provider: () => number) {
    this.sinceProvider = provider;
  }

  /** The name or avatar changed (the user finished signing in): tell the server without dropping the connection. */
  updateSession(session: SessionInfo) {
    this.session = session;
    if (this.isOpen) this.sendJoin();
  }

  /** Asks for what changed since `since` (0 = the whole board); the answer arrives as a `sync` event. */
  requestSync(since: number) {
    this.send({ t: "sync", since });
  }

  /** Sends a batch of canvas operations and resolves once the server has stored them. */
  sendOps(ops: WireOp[]): Promise<{ applied: number }> {
    return new Promise((resolve, reject) => {
      if (!this.isOpen) return reject(new ConnectionLostError());
      const id = this.nextOpId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ConnectionLostError("The server did not answer in time."));
      }, OPS_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ t: "ops", id, ops });
    });
  }

  sendPresence(p: PresenceState) {
    if (this.isOpen) this.send({ t: "presence", ...p });
  }

  /* ----------------------------------------------------------------- connection */

  private emit<K extends keyof SocketHandlers>(name: K, ...args: Parameters<SocketHandlers[K]>) {
    for (const l of Array.from(this.listeners)) (l[name] as ((...a: Parameters<SocketHandlers[K]>) => void) | undefined)?.(...args);
  }

  private setStatus(status: SocketStatus, info: SocketInfo | null) {
    if (this.status === status && this.info?.access === info?.access && this.info?.nudges === info?.nudges) return;
    this.status = status;
    this.info = info;
    this.emit("status", status, info);
  }

  private send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private sendJoin() {
    this.getTokenSafely().then((token) => {
      if (this.stopped || !this.ws || this.ws.readyState !== 1) return;
      if (token === undefined) {
        this.ws.close(); // could not get the sign-in token: reconnect and try again rather than join as somebody else
        return;
      }
      this.send({ t: "join", slateId: this.opts.slateId, token, since: this.sinceProvider(), session: this.session });
    });
  }

  /** `undefined` = the token could not be fetched (do not join as somebody else). */
  private async getTokenSafely(): Promise<string | null | undefined> {
    try {
      return await Promise.race([this.opts.getToken(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 8000))]);
    } catch {
      return undefined;
    }
  }

  private connectNow() {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.closeSocket();
    this.setStatus("connecting", null);
    const WS = this.opts.WebSocketImpl ?? globalThis.WebSocket;
    let ws: WebSocket;
    try {
      ws = new WS(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.lastHeard = Date.now();
    ws.onopen = () => {
      if (this.ws === ws) this.sendJoin();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastHeard = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClosed();
    };
    ws.onerror = () => undefined; // followed by close
    // An attempt can hang for minutes (a server that just went away, a network that drops packets): don't wait for the browser to give up.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.ws !== ws || this.status === "open") return;
      this.closeSocket();
      this.setStatus("closed", null);
      this.scheduleReconnect();
    }, this.opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
    if (this.watchdog) clearInterval(this.watchdog);
    const silence = this.opts.silenceMs ?? HEARTBEAT_TIMEOUT_MS;
    this.watchdog = setInterval(() => {
      if (this.ws === ws && Date.now() - this.lastHeard > silence) ws.close(); // half-open: the network went away without a goodbye
    }, Math.min(5000, Math.max(50, silence / 4)));
  }

  private closeSocket() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this.failPending(new ConnectionLostError());
    this.peerMap.clear();
  }

  private onClosed() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.failPending(new ConnectionLostError());
    const had = this.peerMap.size > 0;
    this.peerMap.clear();
    if (had) this.emit("peers", []);
    this.setStatus("closed", null);
    this.scheduleReconnect();
  }

  private scheduleReconnect(delayMs?: number) {
    if (this.stopped || this.retryTimer) return;
    const min = this.opts.minBackoffMs ?? 500;
    const max = this.opts.maxBackoffMs ?? 15_000;
    const base = delayMs ?? Math.min(max, min * 2 ** Math.min(this.attempt, 10));
    this.attempt += 1;
    const jitter = base * (0.75 + Math.random() * 0.5);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connectNow();
    }, jitter);
  }

  private failPending(err: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case "joined":
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        this.attempt = 0;
        this.authRetries = 0;
        this.peerMap = new Map(msg.peers.map((p) => [p.sessionId, p]));
        this.setStatus("open", { access: msg.access, nudges: msg.nudges });
        this.emit("peers", this.peers());
        break;
      case "denied":
        if (msg.reason === "auth" && this.authRetries < 2) {
          // the token expired between fetching and checking it: fetch a fresh one and join again
          this.authRetries += 1;
          this.sendJoin();
          break;
        }
        this.emit("denied", msg.reason, msg.message);
        // access can be granted later (an accepted invitation, a new link setting), so keep trying, slowly
        this.closeSocket();
        this.setStatus("closed", null);
        this.scheduleReconnect(msg.reason === "missing" ? 60_000 : 20_000);
        break;
      case "sync":
        this.emit("sync", msg);
        break;
      case "elements":
        this.emit("elements", msg);
        break;
      case "ack": {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve({ applied: msg.applied });
        }
        break;
      }
      case "error": {
        const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
        if (p && msg.id !== undefined) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.reject(new Error(msg.message));
        }
        break;
      }
      case "peer":
        this.peerMap.set(msg.peer.sessionId, msg.peer);
        this.emit("peers", this.peers());
        break;
      case "left":
        if (this.peerMap.delete(msg.sessionId)) this.emit("peers", this.peers());
        break;
      case "access":
        if (this.info) this.setStatus("open", { ...this.info, access: msg.access });
        this.emit("access", msg.access);
        break;
      case "revoked":
        this.emit("revoked");
        this.peerMap.clear();
        this.emit("peers", []);
        this.setStatus("closed", null); // out of the room; try again later in case access comes back
        this.closeSocket();
        this.scheduleReconnect(20_000);
        break;
      case "nudge":
        this.emit("nudge", msg.topic);
        break;
      case "hb":
        break;
    }
  }
}
