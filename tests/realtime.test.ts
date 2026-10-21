import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";
import { api } from "@/lib/client/api";
import { getCollections } from "@/lib/db/mongo";
import { startRealtimeServer, type RealtimeServer } from "@/lib/realtime/server";
import { as, EDITOR, OWNER, resetDb, setup, startReplDb, stopDb, STRANGER, VIEWER, type TestUser } from "./helpers/db";
import { sleep, TestSocket } from "./helpers/ws";

/** Tokens in these tests are "test:<userId>"; production verifies Clerk session tokens instead. */
const verifyToken = async (token: string) => (token.startsWith("test:") ? { userId: token.slice(5) } : null);

const put = (id: string, z = 1, extra: object = {}) => ({ t: "put" as const, id, z, data: JSON.stringify({ id, type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, z, ...extra }) });

beforeAll(startReplDb);
afterAll(stopDb);
beforeEach(resetDb);

const open: TestSocket[] = [];
let sessionCounter = 0;

async function join(server: RealtimeServer, who: TestUser | null, slateId: string, opts: { since?: number; name?: string; sessionId?: string; token?: string | null } = {}) {
  const sock = await TestSocket.connect(server.port);
  open.push(sock);
  const sessionId = opts.sessionId ?? `s${++sessionCounter}`;
  sock.send({
    t: "join",
    slateId,
    token: opts.token !== undefined ? opts.token : who ? `test:${who.subject}` : null,
    since: opts.since ?? 0,
    session: { id: sessionId, name: opts.name ?? who?.name ?? "Guest", color: "#336699" },
  });
  return { sock, sessionId };
}

/** Joins and waits for the board to arrive. */
async function joined(server: RealtimeServer, who: TestUser | null, slateId: string, opts: Parameters<typeof join>[3] = {}) {
  const r = await join(server, who, slateId, opts);
  const hello = await r.sock.take("joined");
  const board = await r.sock.take("sync");
  return { ...r, hello, board };
}

for (const feed of ["stream", "poll"] as const) {
  describe(`realtime server (${feed} feed)`, () => {
    let server: RealtimeServer;
    beforeAll(async () => {
      server = await startRealtimeServer({ port: 0, verifyToken, changeFeed: feed, pollMs: 40, accessRecheckMs: 3_600_000, heartbeatMs: 3_600_000 });
    });
    afterAll(async () => {
      await server.close();
    });
    beforeEach(() => {
      for (const s of open.splice(0)) s.close();
    });

    it("uses the feed it was asked for", () => {
      expect(server.feed).toBe(feed);
      expect(server.stats().rooms).toBe(0);
    });

    describe("joining", () => {
      it("lets members in and sends them the board", async () => {
        const { slateId } = await setup();
        await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a"), put("b", 2)] });
        const { hello, board } = await joined(server, VIEWER, slateId);
        expect(hello).toMatchObject({ access: "view", peers: [], nudges: feed === "stream" });
        expect(board.full).toBe(true);
        expect(board.puts.map((p) => p.eid).sort()).toEqual(["a", "b"]);
        expect(board.cursor).toBe(2);
        const editor = await joined(server, EDITOR, slateId);
        expect(editor.hello.access).toBe("edit");
      });

      it("sends only what changed when the client says where it was", async () => {
        const { slateId } = await setup();
        await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
        const first = await joined(server, VIEWER, slateId);
        const c = await getCollections();
        await c.elements.updateMany({ slateId }, { $set: { updatedAt: 1 } }); // the 5 s overlap window would resend recent rows
        await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("b")] });
        await c.elements.updateMany({ slateId, eid: "a" }, { $set: { updatedAt: 1 } });
        const again = await joined(server, VIEWER, slateId, { since: first.board.cursor });
        expect(again.board.full).toBe(false);
        expect(again.board.puts.map((p) => p.eid)).toEqual(["b"]);
      });

      it("keeps strangers and signed-out visitors out of private boards, and tells them why", async () => {
        const { slateId } = await setup();
        for (const who of [STRANGER, null]) {
          const { sock } = await join(server, who, slateId);
          expect(await sock.take("denied")).toMatchObject({ reason: "access" });
          expect(sock.all("joined")).toHaveLength(0);
        }
        const missing = await join(server, OWNER, "no-such-board");
        expect(await missing.sock.take("denied")).toMatchObject({ reason: "missing" });
        const forged = await join(server, OWNER, slateId, { token: "forged-token" });
        expect(await forged.sock.take("denied")).toMatchObject({ reason: "auth" });
      });

      it("lets anyone view a board that has a view link, but not change it", async () => {
        const { slateId } = await setup();
        await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
        const anon = await joined(server, null, slateId);
        expect(anon.hello.access).toBe("view");
        anon.sock.send({ t: "ops", id: 1, ops: [put("x")] });
        expect(await anon.sock.take("error", (m) => m.id === 1)).toMatchObject({ message: expect.stringMatching(/view access/) });
        await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" });
        const stranger = await joined(server, STRANGER, slateId);
        expect(stranger.hello.access).toBe("edit");
        const anonOnEditLink = await joined(server, null, slateId);
        expect(anonOnEditLink.hello.access).toBe("view");
      });

      it("a tab that reconnects replaces its old connection instead of showing up twice", async () => {
        const { slateId } = await setup();
        const watcher = await joined(server, OWNER, slateId);
        const first = await joined(server, EDITOR, slateId, { sessionId: "tab-1" });
        await watcher.sock.take("peer", (m) => m.peer.sessionId === "tab-1");
        const second = await joined(server, EDITOR, slateId, { sessionId: "tab-1" });
        expect((await first.sock.untilClosed()).code).toBe(4001);
        await watcher.sock.take("left", (m) => m.sessionId === "tab-1");
        expect(second.hello.peers.map((p) => p.sessionId)).toEqual([watcher.sessionId]);
      });
    });

    describe("writing and pushing", () => {
      it("acknowledges a write and pushes it to everybody on the board, the writer included", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        const b = await joined(server, VIEWER, slateId);
        a.sock.send({ t: "ops", id: 7, ops: [put("box", 3, { x: 40 })] });
        expect(await a.sock.take("ack", (m) => m.id === 7)).toMatchObject({ applied: 1 });
        for (const s of [a.sock, b.sock]) {
          const push = await s.take("elements", (m) => m.puts.some((p) => p.eid === "box"));
          expect(push.puts[0]).toMatchObject({ eid: "box", z: 3, rev: 1 });
          expect(JSON.parse(push.puts[0].data)).toMatchObject({ x: 40 });
        }
        a.sock.send({ t: "ops", id: 8, ops: [{ t: "del", id: "box" }] });
        await a.sock.take("ack", (m) => m.id === 8);
        expect(await b.sock.take("elements", (m) => m.dels.includes("box"))).toMatchObject({ dels: ["box"] });
        expect(await (await getCollections()).elements.countDocuments({ slateId, deleted: true })).toBe(1);
      });

      it("pushes changes made through the HTTP API too", async () => {
        const { slateId } = await setup();
        const b = await joined(server, VIEWER, slateId);
        await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("from-http", 2)] });
        expect(await b.sock.take("elements", (m) => m.puts.some((p) => p.eid === "from-http"))).toBeTruthy();
      });

      it("pushes each write once, however many sources report it", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        a.sock.send({ t: "ops", id: 1, ops: [put("once")] });
        await a.sock.take("ack");
        await sleep(400);
        const frames = a.sock.all("elements").flatMap((m) => m.puts.filter((p) => p.eid === "once" && p.rev === 1));
        expect(frames).toHaveLength(1);
      });

      it("pushes a big batch in several frames", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        const b = await joined(server, VIEWER, slateId);
        a.sock.send({ t: "ops", id: 1, ops: Array.from({ length: 500 }, (_, i) => put(`e${i}`, i)) });
        await a.sock.take("ack", (m) => m.id === 1, 10_000);
        const seen = new Set<string>();
        while (seen.size < 500) for (const p of (await b.sock.take("elements", () => true, 10_000)).puts) seen.add(p.eid);
        expect(seen.size).toBe(500);
      });

      it("refuses what the HTTP API refuses, with the same message", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        a.sock.send({ t: "ops", id: 1, ops: Array.from({ length: 501 }, (_, i) => put(`x${i}`)) });
        expect(await a.sock.take("error", (m) => m.id === 1)).toMatchObject({ message: expect.stringMatching(/Too many/) });
        a.sock.send({ t: "ops", id: 2, ops: [{ t: "del", id: "" }] });
        expect(await a.sock.take("error", (m) => m.id === 2)).toMatchObject({ message: expect.stringMatching(/Invalid element id/) });
        const viewer = await joined(server, VIEWER, slateId);
        viewer.sock.send({ t: "ops", id: 3, ops: [put("v")] });
        expect(await viewer.sock.take("error", (m) => m.id === 3)).toMatchObject({ message: expect.stringMatching(/view access/) });
        expect(await (await getCollections()).elements.countDocuments({ slateId })).toBe(0);
      });

      it("serves an explicit sync request", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        await as(OWNER).mutation(api.elements.apply, { slateId, ops: [put("later")] });
        a.sock.send({ t: "sync", since: 0 });
        expect((await a.sock.take("sync")).puts.map((p) => p.eid)).toEqual(["later"]);
      });
    });

    describe("live cursors", () => {
      it("shows who is already here, relays cursors and removes people who leave", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId, { name: "Ed" });
        const b = await joined(server, OWNER, slateId, { name: "Olive" });
        expect(b.hello.peers).toEqual([expect.objectContaining({ sessionId: a.sessionId, name: "Ed", userId: EDITOR.subject, cursor: null })]);
        expect((await a.sock.take("peer", (m) => m.peer.sessionId === b.sessionId)).peer.name).toBe("Olive");

        a.sock.send({ t: "presence", cursor: { x: 10.5, y: -4 }, selection: ["a", "b"], tool: "select" });
        const moved = await b.sock.take("peer", (m) => m.peer.sessionId === a.sessionId && m.peer.cursor !== null);
        expect(moved.peer).toMatchObject({ cursor: { x: 10.5, y: -4 }, selection: ["a", "b"], tool: "select", color: "#336699" });
        expect(a.sock.all("peer").filter((m) => m.peer.sessionId === a.sessionId)).toHaveLength(0); // you never get yourself back

        a.sock.send({ t: "presence", cursor: null, selection: [], drag: { ids: ["a"], dx: 5, dy: 6 }, draft: '{"id":"d","type":"shape"}' });
        const drag = await b.sock.take("peer", (m) => !!m.peer.drag);
        expect(drag.peer).toMatchObject({ drag: { ids: ["a"], dx: 5, dy: 6 }, draft: '{"id":"d","type":"shape"}', cursor: null });

        a.sock.close();
        await b.sock.take("left", (m) => m.sessionId === a.sessionId);
        const late = await joined(server, VIEWER, slateId);
        expect(late.hello.peers.map((p) => p.sessionId)).toEqual([b.sessionId]);
      });

      it("never writes cursors to the database", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        for (let i = 0; i < 20; i++) a.sock.send({ t: "presence", cursor: { x: i, y: i }, selection: [] });
        await sleep(200);
        expect(await (await getCollections()).liveSessions.countDocuments()).toBe(0);
      });

      it("clamps and trims what a client says about itself", async () => {
        const { slateId } = await setup();
        await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
        const watcher = await joined(server, OWNER, slateId);
        const anon = await joined(server, null, slateId, { name: "  " + "x".repeat(150), sessionId: "anon-1" });
        const hello = await watcher.sock.take("peer", (m) => m.peer.sessionId === "anon-1");
        expect(hello.peer.name.length).toBeLessThanOrEqual(60);
        expect(hello.peer.userId).toBe("anon:anon-1");
        anon.sock.send({ t: "presence", cursor: { x: 1e12, y: -1e12 }, selection: Array.from({ length: 400 }, (_, i) => `s${i}`), tool: "x".repeat(40) });
        const p = (await watcher.sock.take("peer", (m) => m.peer.cursor !== null)).peer;
        expect(Math.abs(p.cursor!.x)).toBeLessThanOrEqual(1e7);
        expect(p.selection.length).toBeLessThanOrEqual(60);
        expect(p.tool!.length).toBeLessThanOrEqual(20);
      });
    });

    describe("access that changes while connected", () => {
      it("removes a person whose membership was deleted, and downgrades one who became a viewer", async () => {
        const { slateId } = await setup();
        const c = await getCollections();
        const editor = await joined(server, EDITOR, slateId);
        const owner = await joined(server, OWNER, slateId);
        await c.workspaceMembers.updateOne({ userId: EDITOR.subject }, { $set: { role: "Viewer" } });
        await server.sweepAccess();
        expect(await editor.sock.take("access")).toEqual({ t: "access", access: "view" });
        editor.sock.send({ t: "ops", id: 1, ops: [put("nope")] });
        expect(await editor.sock.take("error", (m) => m.id === 1)).toMatchObject({ message: expect.stringMatching(/view access/) });

        await c.workspaceMembers.deleteOne({ userId: EDITOR.subject });
        await server.sweepAccess();
        await editor.sock.take("revoked");
        await owner.sock.take("left", (m) => m.sessionId === editor.sessionId);
        editor.sock.send({ t: "ops", id: 2, ops: [put("nope")] });
        expect(await editor.sock.take("error", (m) => m.id === 2)).toMatchObject({ message: "Join a board first." });
      });

      it("removes everyone when the board is deleted", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        await as(OWNER).mutation(api.slates.remove, { id: slateId });
        if (feed === "stream") await a.sock.take("revoked"); // the slates stream notices on its own
        else await server.sweepAccess().then(() => a.sock.take("revoked"));
      });
    });

    describe("nudges", () => {
      it(feed === "stream" ? "tells the board when comments or its settings change" : "does not promise nudges it cannot send", async () => {
        const { slateId } = await setup();
        const a = await joined(server, VIEWER, slateId);
        expect(a.hello.nudges).toBe(feed === "stream");
        if (feed !== "stream") return;
        await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: { kind: "point", x: 1, y: 2 }, body: "hello", mentions: [] });
        expect(await a.sock.take("nudge", (m) => m.topic === "comments")).toBeTruthy();
        await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
        expect(await a.sock.take("nudge", (m) => m.topic === "slate")).toBeTruthy();
        // an ordinary edit (which bumps the board's change counter) is not a settings change
        await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("quiet")] });
        await sleep(300);
        expect(a.sock.all("nudge").filter((m) => m.topic === "slate")).toHaveLength(0);
      });
    });

    describe("bad input", () => {
      it("answers garbage with an error, not a crash, and closes after a flood of it", async () => {
        const { slateId } = await setup();
        const a = await joined(server, EDITOR, slateId);
        a.sock.ws.send("not json");
        a.sock.ws.send(JSON.stringify({ t: "ops", id: "nope" }));
        a.sock.ws.send(JSON.stringify({ t: "nonsense" }));
        for (let i = 0; i < 3; i++) await a.sock.take("error"); // one answer per bad message
        // the connection still works
        a.sock.send({ t: "ops", id: 1, ops: [put("still-works")] });
        expect(await a.sock.take("ack", (m) => m.id === 1)).toMatchObject({ applied: 1 });
        for (let i = 0; i < 15; i++) a.sock.ws.send("garbage");
        expect((await a.sock.untilClosed()).code).toBe(4003);
      });

      it("won't take ops or presence before a join", async () => {
        const sock = await TestSocket.connect(server.port);
        open.push(sock);
        sock.send({ t: "ops", id: 5, ops: [put("x")] });
        expect(await sock.take("error", (m) => m.id === 5)).toMatchObject({ message: "Join a board first." });
        sock.send({ t: "presence", cursor: null, selection: [] }); // silently ignored
        sock.send({ t: "sync", since: 0 });
        expect(await sock.take("error")).toMatchObject({ message: "Join a board first." });
      });

      it("serves a health check and nothing else over plain HTTP", async () => {
        const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json());
        expect(health).toMatchObject({ ok: true, feed });
        expect((await fetch(`http://127.0.0.1:${server.port}/anything`)).status).toBe(404);
      });
    });
  });
}

describe("realtime server limits", () => {
  it("turns away connections from a disallowed origin", async () => {
    const server = await startRealtimeServer({ port: 0, verifyToken, changeFeed: "poll", allowedOrigins: ["https://slate.example"] });
    try {
      const attempt = (origin: string) =>
        new Promise<"open" | number>((resolve) => {
          const ws = new NodeWebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { Origin: origin } });
          ws.on("open", () => {
            ws.close();
            resolve("open");
          });
          ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
          ws.on("error", () => undefined);
        });
      expect(await attempt("https://slate.example")).toBe("open");
      expect(await attempt("https://evil.example")).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("limits connections per address", async () => {
    const server = await startRealtimeServer({ port: 0, verifyToken, changeFeed: "poll", maxConnectionsPerIp: 2 });
    try {
      const a = await TestSocket.connect(server.port);
      const b = await TestSocket.connect(server.port);
      await expect(TestSocket.connect(server.port)).rejects.toThrow();
      a.close();
      await sleep(100);
      const c = await TestSocket.connect(server.port); // a slot is free again
      b.close();
      c.close();
    } finally {
      await server.close();
    }
  });

  it("drops a connection that stops answering pings", async () => {
    const server = await startRealtimeServer({ port: 0, verifyToken, changeFeed: "poll", heartbeatMs: 80 });
    try {
      const ws = new NodeWebSocket(`ws://127.0.0.1:${server.port}/ws`, { autoPong: false });
      const closed = new Promise<void>((resolve) => ws.on("close", () => resolve()));
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));
      await Promise.race([closed, sleep(8000).then(() => Promise.reject(new Error("never dropped")))]);
      for (let i = 0; i < 200 && server.stats().sockets > 0; i++) await sleep(25);
      expect(server.stats().sockets).toBe(0);
      // a healthy client (which answers pings) stays connected and hears heartbeats
      const good = await TestSocket.connect(server.port);
      await good.take("hb");
      await sleep(300);
      expect(good.closed).toBeNull();
      good.close();
    } finally {
      await server.close();
    }
  });
});
