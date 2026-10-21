import { createServer } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "@/lib/client/api";
import { BoardSocket, ConnectionLostError, realtimeUrl, type SocketHandlers, type SocketStatus } from "@/lib/client/realtime";
import { startRealtimeServer, type RealtimeServer } from "@/lib/realtime/server";
import { as, EDITOR, OWNER, resetDb, setup, startDb, stopDb, STRANGER, VIEWER, type TestUser } from "./helpers/db";
import { sleep } from "./helpers/ws";

// A plain mongod (no change streams) is enough here: these tests are about the browser end, and the server falls back to polling.
const verifyToken = async (token: string) => (token.startsWith("test:") ? { userId: token.slice(5) } : null);
const put = (id: string, z = 1, extra: object = {}) => ({ t: "put" as const, id, z, data: JSON.stringify({ id, type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, z, ...extra }) });

let server: RealtimeServer;
const sockets: BoardSocket[] = [];
let n = 0;

beforeAll(async () => {
  await startDb();
});
afterAll(stopDb);
beforeEach(async () => {
  await resetDb();
  server = await startRealtimeServer({ port: 0, verifyToken, changeFeed: "poll", pollMs: 30, accessRecheckMs: 3_600_000, heartbeatMs: 3_600_000 });
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.stop();
  await server.close();
});

function client(who: TestUser | null, slateId: string, extra: Partial<ConstructorParameters<typeof BoardSocket>[0]> = {}) {
  const id = `tab${++n}`;
  const s = new BoardSocket({
    url: `ws://127.0.0.1:${server.port}/ws`,
    slateId,
    session: { id, name: who?.name ?? "Guest", color: "#112233" },
    getToken: async () => (who ? `test:${who.subject}` : null),
    minBackoffMs: 20,
    maxBackoffMs: 100,
    ...extra,
  });
  sockets.push(s);
  const log: { status: SocketStatus[]; sync: Parameters<SocketHandlers["sync"]>[0][]; elements: Parameters<SocketHandlers["elements"]>[0][]; peers: string[][]; denied: string[]; nudges: string[]; revoked: number; access: string[] } = {
    status: [],
    sync: [],
    elements: [],
    peers: [],
    denied: [],
    nudges: [],
    revoked: 0,
    access: [],
  };
  s.subscribe({
    status: (st) => log.status.push(st),
    sync: (m) => log.sync.push(m),
    elements: (m) => log.elements.push(m),
    peers: (p) => log.peers.push(p.map((x) => x.name).sort()),
    denied: (r) => log.denied.push(r),
    nudge: (t) => log.nudges.push(t),
    revoked: () => log.revoked++,
    access: (a) => log.access.push(a),
  });
  return { s, log, id };
}

const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await sleep(15);
  }
};

describe("BoardSocket", () => {
  it("connects, joins with the caller's token and receives the board", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a"), put("b")] });
    const { s, log } = client(VIEWER, slateId);
    s.start();
    await until(() => log.sync.length > 0);
    expect(s.status).toBe("open");
    expect(s.info).toEqual({ access: "view", nudges: false });
    expect(log.status.slice(0, 2)).toEqual(["connecting", "open"]);
    expect(log.sync[0].full).toBe(true);
    expect(log.sync[0].puts.map((p) => p.eid).sort()).toEqual(["a", "b"]);
  });

  it("asks for a catch-up from where the board holder says it is", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
    const { s, log } = client(VIEWER, slateId);
    s.start();
    await until(() => log.sync.length === 1);
    const cursor = log.sync[0].cursor;
    await sleep(5200); // past the server's re-send window for recent rows
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("b")] });
    s.setSinceProvider(() => cursor);
    s.stop();
    s.start();
    await until(() => log.sync.length === 2);
    expect(log.sync[1].full).toBe(false);
    expect(log.sync[1].puts.map((p) => p.eid)).toEqual(["b"]);
  }, 15_000);

  it("writes are acknowledged, and pushed to the other people on the board", async () => {
    const { slateId } = await setup();
    const a = client(EDITOR, slateId);
    const b = client(VIEWER, slateId);
    a.s.start();
    b.s.start();
    await until(() => a.s.isOpen && b.s.isOpen);
    await expect(a.s.sendOps([put("box", 2, { x: 7 })])).resolves.toEqual({ applied: 1 });
    await until(() => b.log.elements.some((m) => m.puts.some((p) => p.eid === "box")));
    expect(b.log.elements.flatMap((m) => m.puts).find((p) => p.eid === "box")).toMatchObject({ z: 2, rev: 1 });
    await expect(a.s.sendOps([{ t: "del", id: "box" }])).resolves.toMatchObject({ applied: 1 });
    await until(() => b.log.elements.some((m) => m.dels.includes("box")));
  });

  it("a refused write rejects with the server's reason; a write with no connection rejects as 'connection lost'", async () => {
    const { slateId } = await setup();
    const v = client(VIEWER, slateId);
    v.s.start();
    await until(() => v.s.isOpen);
    const refused = await v.s.sendOps([put("x")]).catch((e: Error) => e);
    expect(refused).toBeInstanceOf(Error);
    expect(refused).not.toBeInstanceOf(ConnectionLostError); // the caller must not retry this over HTTP
    expect((refused as Error).message).toMatch(/view access/);

    const idle = client(EDITOR, slateId);
    await expect(idle.s.sendOps([put("y")])).rejects.toBeInstanceOf(ConnectionLostError);
  });

  it("relays presence and shows who joins and leaves", async () => {
    const { slateId } = await setup();
    const a = client(EDITOR, slateId);
    const b = client(OWNER, slateId);
    a.s.start();
    await until(() => a.s.isOpen);
    b.s.start();
    await until(() => a.log.peers.some((p) => p.includes("Owner")) && b.s.isOpen);
    expect(b.s.peers().map((p) => p.name)).toEqual(["Editor"]); // B sees A from the moment it joined
    a.s.sendPresence({ cursor: { x: 5, y: 6 }, selection: ["q"] });
    await until(() => b.s.peers().some((p) => p.cursor?.x === 5));
    expect(b.s.peers()[0]).toMatchObject({ cursor: { x: 5, y: 6 }, selection: ["q"] });
    a.s.stop();
    await until(() => b.s.peers().length === 0);
    expect(b.log.peers.at(-1)).toEqual([]);
  });

  it("changes the name other people see without reconnecting", async () => {
    const { slateId } = await setup();
    const a = client(EDITOR, slateId);
    const b = client(OWNER, slateId);
    a.s.start();
    b.s.start();
    await until(() => a.s.isOpen && b.s.isOpen && b.s.peers().length === 1);
    a.s.updateSession({ id: a.id, name: "Eddie Renamed", color: "#445566" });
    await until(() => b.s.peers().some((p) => p.name === "Eddie Renamed"));
    expect(b.s.peers()).toHaveLength(1); // renamed, not duplicated
    expect(a.log.status.filter((s) => s === "connecting")).toHaveLength(1);
  });

  it("reconnects by itself when the server restarts, rejects writes that were in flight, and catches up", async () => {
    const { slateId } = await setup();
    const port = server.port;
    // a connection attempt made while the server is going down may hang instead of failing: the timeout must free it
    const a = client(EDITOR, slateId, { connectTimeoutMs: 1000 });
    a.s.start();
    await until(() => a.s.isOpen);
    await server.close();
    await until(() => a.s.status !== "open");
    await expect(a.s.sendOps([put("while-down")])).rejects.toBeInstanceOf(ConnectionLostError);
    // someone writes over HTTP while the realtime server is down
    await as(OWNER).mutation(api.elements.apply, { slateId, ops: [put("missed-while-down")] });
    server = await startRealtimeServer({ port, verifyToken, changeFeed: "poll", pollMs: 30, accessRecheckMs: 3_600_000, heartbeatMs: 3_600_000 });
    await until(() => a.s.isOpen, 12_000);
    await until(() => a.log.sync.some((m) => m.puts.some((p) => p.eid === "missed-while-down")));
    await expect(a.s.sendOps([put("after")])).resolves.toMatchObject({ applied: 1 });
  });

  it("gives up on a connection attempt that never completes and tries again", async () => {
    const { slateId } = await setup();
    // a server that accepts the TCP connection and then says nothing (a dropped network, an overloaded host)
    let accepted = 0;
    const blackHole = createServer((socket) => {
      accepted++;
      socket.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => blackHole.listen(0, "127.0.0.1", resolve));
    try {
      const port = (blackHole.address() as { port: number }).port;
      const a = client(EDITOR, slateId, { url: `ws://127.0.0.1:${port}/ws`, connectTimeoutMs: 150 });
      a.s.start();
      await until(() => accepted >= 3); // it keeps trying instead of waiting on the first attempt for ever
      expect(a.s.isOpen).toBe(false);
      expect(a.log.status).toContain("closed");
      a.s.stop();
    } finally {
      blackHole.close();
    }
  });

  it("fails a write that gets no answer instead of hanging", async () => {
    const { slateId } = await setup();
    const a = client(EDITOR, slateId);
    a.s.start();
    await until(() => a.s.isOpen);
    const answer = a.s.sendOps(Array.from({ length: 5 }, (_, i) => put(`e${i}`))).then(() => "acked" as const, (e: Error) => e);
    await server.close(); // the answer may never come
    const result = await answer;
    expect(result === "acked" || result instanceof ConnectionLostError).toBe(true);
  });

  it("reconnects when the server goes silent (a half-open connection)", async () => {
    const { slateId } = await setup();
    const a = client(EDITOR, slateId, { silenceMs: 250 });
    a.s.start();
    await until(() => a.s.isOpen);
    // the server's heartbeat is off in these tests, so after `silenceMs` without any frame the client reconnects
    await until(() => a.log.status.filter((s) => s === "connecting").length >= 2, 10_000);
    await until(() => a.s.isOpen);
  });

  it("is told when it may not join, and keeps trying slowly in case that changes", async () => {
    const { slateId } = await setup();
    const stranger = client(STRANGER, slateId);
    stranger.s.start();
    await until(() => stranger.log.denied.length > 0);
    expect(stranger.log.denied[0]).toBe("access");
    expect(stranger.s.status).toBe("closed");
    const ghost = client(OWNER, "no-such-board");
    ghost.s.start();
    await until(() => ghost.log.denied.length > 0);
    expect(ghost.log.denied[0]).toBe("missing");
  });

  it("refetches the sign-in token when it was rejected, and gives up after two tries", async () => {
    const { slateId } = await setup();
    let calls = 0;
    const bad = client(OWNER, slateId, {
      getToken: async () => {
        calls++;
        return "expired-token";
      },
    });
    bad.s.start();
    await until(() => bad.log.denied.length > 0);
    expect(bad.log.denied[0]).toBe("auth");
    expect(calls).toBe(3); // the first join, then two retries with a fresh token

    let first = true;
    const flaky = client(OWNER, slateId, {
      getToken: async () => {
        if (first) {
          first = false;
          return "expired-token";
        }
        return `test:${OWNER.subject}`;
      },
    });
    flaky.s.start();
    await until(() => flaky.s.isOpen);
    expect(flaky.log.denied).toEqual([]);
  });

  it("does not join as somebody else when the token can't be fetched", async () => {
    const { slateId } = await setup();
    await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
    let fail = true;
    const c = client(OWNER, slateId, {
      getToken: async () => {
        if (fail) throw new Error("clerk unavailable");
        return `test:${OWNER.subject}`;
      },
    });
    c.s.start();
    await sleep(300);
    expect(c.s.isOpen).toBe(false); // an anonymous join would have succeeded (view link); it must not be tried
    fail = false;
    await until(() => c.s.isOpen);
    expect(c.s.info?.access).toBe("edit");
  });

  it("hears about rights changing and being withdrawn", async () => {
    const { slateId } = await setup();
    const a = client(EDITOR, slateId);
    a.s.start();
    await until(() => a.s.isOpen);
    const { getCollections } = await import("@/lib/db/mongo");
    const c = await getCollections();
    await c.workspaceMembers.updateOne({ userId: EDITOR.subject }, { $set: { role: "Viewer" } });
    await server.sweepAccess();
    await until(() => a.log.access.includes("view"));
    expect(a.s.info?.access).toBe("view");
    await c.workspaceMembers.deleteOne({ userId: EDITOR.subject });
    await server.sweepAccess();
    await until(() => a.log.revoked === 1);
    expect(a.s.isOpen).toBe(false);
  });

  it("stops cleanly: no more reconnects after stop()", async () => {
    const { slateId } = await setup();
    const a = client(EDITOR, slateId);
    a.s.start();
    await until(() => a.s.isOpen);
    a.s.stop();
    expect(a.s.status).toBe("idle");
    await sleep(300);
    expect(server.stats().sockets).toBe(0);
    expect(a.s.status).toBe("idle");
  });
});

describe("realtimeUrl", () => {
  it("builds the socket address from the configured server, or turns realtime off", () => {
    const previous = process.env.NEXT_PUBLIC_REALTIME_URL;
    try {
      process.env.NEXT_PUBLIC_REALTIME_URL = "wss://realtime.example.com/";
      expect(realtimeUrl()).toBe("wss://realtime.example.com/ws");
      process.env.NEXT_PUBLIC_REALTIME_URL = "ws://localhost:4000/ws";
      expect(realtimeUrl()).toBe("ws://localhost:4000/ws");
      process.env.NEXT_PUBLIC_REALTIME_URL = "off";
      expect(realtimeUrl()).toBeNull();
      delete process.env.NEXT_PUBLIC_REALTIME_URL;
      expect(realtimeUrl()).toBeNull(); // no window and nothing configured: HTTP polling only
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_REALTIME_URL;
      else process.env.NEXT_PUBLIC_REALTIME_URL = previous;
    }
  });
});
