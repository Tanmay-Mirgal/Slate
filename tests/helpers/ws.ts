import type { ClientMessage, ServerMessage } from "@/lib/realtime/protocol";

/** A bare WebSocket client for the realtime server tests: keeps every frame so a test can wait for the one it expects. */
export class TestSocket {
  readonly inbox: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  private listeners = new Set<() => void>();

  private constructor(readonly ws: WebSocket) {
    ws.onmessage = (e) => {
      this.inbox.push(JSON.parse(String(e.data)) as ServerMessage);
      this.wake();
    };
    ws.onclose = (e) => {
      this.closed = { code: e.code, reason: e.reason };
      this.wake();
    };
  }

  static connect(port: number, path = "/ws"): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      const t = new TestSocket(ws);
      ws.onopen = () => resolve(t);
      ws.onerror = () => reject(new Error("could not connect"));
    });
  }

  private wake() {
    for (const l of Array.from(this.listeners)) l();
  }

  send(msg: ClientMessage | Record<string, unknown>) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Takes the first not-yet-taken frame of type `t` (matching `where`), waiting up to `within` ms. */
  take<T extends ServerMessage["t"]>(t: T, where: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, within = 10_000): Promise<Extract<ServerMessage, { t: T }>> {
    return new Promise((resolve, reject) => {
      const find = () => {
        const i = this.inbox.findIndex((m) => m.t === t && where(m as Extract<ServerMessage, { t: T }>));
        if (i < 0) return false;
        const [m] = this.inbox.splice(i, 1);
        done();
        resolve(m as Extract<ServerMessage, { t: T }>);
        return true;
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`no "${t}" frame within ${within} ms; got: ${JSON.stringify(this.inbox.map((m) => m.t))}`));
      }, within);
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(find);
      };
      if (!find()) this.listeners.add(find);
    });
  }

  /** Every frame of type `t` seen so far (not removed). */
  all<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }

  /** Waits until the server closes the socket. */
  async untilClosed(within = 10_000): Promise<{ code: number; reason: string }> {
    const start = Date.now();
    while (!this.closed) {
      if (Date.now() - start > within) throw new Error("socket still open");
      await new Promise<void>((r) => {
        this.listeners.add(r);
        setTimeout(r, 50);
      });
    }
    return this.closed;
  }

  close() {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
