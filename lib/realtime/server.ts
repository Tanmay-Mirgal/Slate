import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import type { ChangeStream, ChangeStreamDocument, Document } from "mongodb";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import { getCollections, type Collections } from "@/lib/db/mongo";
import type { Id, SlateDoc } from "@/lib/db/types";
import { loadSlate, resolveAccess, type Access } from "@/lib/server/access";
import { readChangeRows, readChanges, type ChangeRow } from "@/lib/server/elements";
import { AppError, invoke, type Ctx } from "@/lib/server/fn";
import { cleanAvatar, cleanColor, cleanName, cleanPresence, presenceSchemas } from "@/lib/server/presence";
import { lookup } from "@/lib/server/registry";
import { ensureUser } from "@/lib/server/users";
import {
  CLOSE_BAD_MESSAGE,
  CLOSE_REPLACED,
  CLOSE_SLOW,
  CLOSE_TOO_MANY,
  HEARTBEAT_MS,
  MAX_FRAME_BYTES,
  type PeerWire,
  type ServerMessage,
  type WireElementRow,
} from "./protocol";

/**
 * The realtime server: one long-running Node process that keeps a WebSocket open to every browser on a
 * board. It does three jobs the HTTP API can't:
 *
 *  - pushes every change of a board to everybody on it as it happens (no polling),
 *  - relays live cursors / selections / drag previews between the people on a board (kept in memory, never written to the database),
 *  - takes the board's writes over the same socket (it runs the same `elements.apply` the HTTP API does, so the same checks apply).
 *
 * Changes reach the server through MongoDB: a change stream on the collections of interest, so it does not
 * matter who wrote a row (this process, the HTTP API, a script, another realtime instance). Where change
 * streams don't exist (a standalone mongod) it falls back to reading each active board's changes every few
 * hundred ms. Either way a row is pushed once: a short-lived (eid, rev) memory removes the duplicates.
 *
 * Presence is held per process. Running several instances works for the board data (each watches the database)
 * but cursors are only shared between people connected to the same instance, so route a board's visitors to
 * one instance (sticky by board id) or add a pub/sub in front.
 */

export interface RealtimeOptions {
  /** 0 picks a free port (tests). */
  port?: number;
  host?: string;
  /** Turns a Clerk session token into a user id, or null when it is not valid. */
  verifyToken: (token: string) => Promise<{ userId: string } | null>;
  /** "auto" uses a change stream when the database has them, else polls. */
  changeFeed?: "auto" | "stream" | "poll";
  /** Exact `Origin` values allowed to connect. Empty = any (the sign-in token, not a cookie, is what authenticates). */
  allowedOrigins?: string[];
  /** Poll interval of the fallback feed. */
  pollMs?: number;
  heartbeatMs?: number;
  /** How often every connection's access to its board is checked again. */
  accessRecheckMs?: number;
  maxConnectionsPerIp?: number;
  /** Read X-Forwarded-For for the client address (only behind a proxy you control). */
  trustProxy?: boolean;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export interface RealtimeServer {
  readonly port: number;
  readonly feed: "stream" | "poll";
  stats(): { sockets: number; rooms: number; feed: "stream" | "poll" };
  /** Re-checks every connection's access right now (normally on a timer). */
  sweepAccess(): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------------ messages in */

const zId = z.string().min(1).max(120);
const clientMessage = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("join"),
    slateId: zId,
    token: z.string().max(8192).nullable().optional(),
    since: z.number().int().min(0).optional(),
    session: z.object({ id: z.string().min(1).max(80), name: z.string().max(200), avatar: z.string().max(2000).optional(), color: z.string().max(20) }),
  }),
  z.object({ t: z.literal("sync"), since: z.number().int().min(0) }),
  z.object({ t: z.literal("ops"), id: z.number().int(), ops: z.array(z.unknown()).max(1000) }),
  z.object({
    t: z.literal("presence"),
    cursor: presenceSchemas.cursor,
    selection: z.array(z.string().max(200)).max(500),
    draft: z.string().max(100_000).optional(),
    drag: presenceSchemas.drag.optional(),
    tool: z.string().max(40).optional(),
  }),
  z.object({ t: z.literal("leave") }),
]);
type ClientMsg = z.infer<typeof clientMessage>;

/* ------------------------------------------------------------------------------ state */

interface Session {
  id: string;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
  draft?: string;
  drag?: { ids: string[]; dx: number; dy: number };
  tool?: string;
  lastSeen: number;
}

interface Conn {
  ws: WebSocket;
  ip: string;
  ctx: Ctx;
  room: Room | null;
  session: Session | null;
  access: Access | null;
  alive: boolean;
  /** Messages are handled one after another per connection (a join must finish before the ops behind it). */
  chain: Promise<void>;
  queued: number;
  bad: number;
  bucket: { tokens: number; at: number };
}

interface Room {
  slateId: Id<"slates">;
  conns: Set<Conn>;
  pending: Map<string, WireElementRow>;
  pendingDels: Set<string>;
  /** Highest change number pushed so far: where the next catch-up starts. */
  lastSeq: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** `eid:rev` -> forget-at. The change stream, a catch-up and a poll can all report the same write; only the first is pushed. */
  recent: Map<string, number>;
  nudgeAt: Map<string, number>;
  recheckTimer: ReturnType<typeof setTimeout> | null;
}

const FLUSH_MS = 12;
const ROWS_PER_FRAME = 400;
const RECENT_MS = 15_000;
const SAFETY_CATCHUP_MS = 30_000;
const BUCKET = { capacity: 400, perSecond: 200 };

/** Changes to a board's own settings (not its element counter, which changes with every edit). */
const slateSettingFields = ["title", "linkAccess", "isArchived", "workspaceId"];

export async function startRealtimeServer(opts: RealtimeOptions): Promise<RealtimeServer> {
  const log = opts.log ?? { info: () => undefined, warn: () => undefined, error: () => undefined };
  const rooms = new Map<Id<"slates">, Room>();
  const conns = new Set<Conn>();
  const perIp = new Map<string, number>();
  const maxPerIp = opts.maxConnectionsPerIp ?? 200;
  let closed = false;

  /* ---------------------------------------------------------------------------- send */

  const open = (c: Conn) => c.ws.readyState === WebSocket.OPEN;
  const send = (c: Conn, msg: ServerMessage) => {
    if (open(c)) c.ws.send(JSON.stringify(msg));
  };
  /** `droppable` frames (cursors) are skipped for a client that is not keeping up; the rest close a client that is far behind. */
  const sendRaw = (c: Conn, data: string, droppable = false) => {
    if (!open(c)) return;
    if (c.ws.bufferedAmount > 32 * 1024 * 1024) {
      c.ws.close(CLOSE_SLOW, "too slow");
      return;
    }
    if (droppable && c.ws.bufferedAmount > 1024 * 1024) return;
    c.ws.send(data);
  };
  const broadcast = (room: Room, msg: ServerMessage, except?: Conn, droppable = false) => {
    const data = JSON.stringify(msg);
    for (const c of room.conns) if (c !== except) sendRaw(c, data, droppable);
  };

  const wire = (s: Session): PeerWire => ({
    sessionId: s.id,
    userId: s.userId,
    name: s.name,
    avatar: s.avatar,
    color: s.color,
    cursor: s.cursor,
    selection: s.selection,
    draft: s.draft,
    drag: s.drag,
    tool: s.tool,
    lastSeen: s.lastSeen,
  });

  /* ---------------------------------------------------------------------------- rooms */

  const createRoom = (slate: Pick<SlateDoc, "_id" | "elementSeq">): Room => {
    const room: Room = { slateId: slate._id, conns: new Set(), pending: new Map(), pendingDels: new Set(), lastSeq: slate.elementSeq ?? 0, flushTimer: null, recent: new Map(), nudgeAt: new Map(), recheckTimer: null };
    rooms.set(room.slateId, room);
    return room;
  };

  const destroyRoom = (room: Room) => {
    if (room.flushTimer) clearTimeout(room.flushTimer);
    if (room.recheckTimer) clearTimeout(room.recheckTimer);
    rooms.delete(room.slateId);
  };

  const leaveRoom = (c: Conn) => {
    const room = c.room;
    if (!room) return;
    room.conns.delete(c);
    c.room = null;
    if (c.session) broadcast(room, { t: "left", sessionId: c.session.id });
    c.session = null;
    c.access = null;
    if (room.conns.size === 0) destroyRoom(room);
  };

  /** Queues a row for the next push to the room. */
  const pushRow = (room: Room, r: ChangeRow) => {
    const now = Date.now();
    const key = `${r.eid}:${r.rev}`;
    if (room.recent.has(key)) return;
    const queued = room.pending.get(r.eid);
    if (queued && queued.rev > r.rev) return; // an older write reported late
    room.recent.set(key, now + RECENT_MS);
    if (r.seq > room.lastSeq) room.lastSeq = r.seq;
    if (r.deleted) {
      room.pending.delete(r.eid);
      room.pendingDels.add(r.eid);
    } else {
      room.pendingDels.delete(r.eid);
      room.pending.set(r.eid, { eid: r.eid, z: r.z, rev: r.rev, data: r.data });
    }
    if (!room.flushTimer) room.flushTimer = setTimeout(() => flushRoom(room), FLUSH_MS);
  };

  const flushRoom = (room: Room) => {
    room.flushTimer = null;
    const puts = Array.from(room.pending.values());
    const dels = Array.from(room.pendingDels);
    room.pending.clear();
    room.pendingDels.clear();
    const now = Date.now();
    if (room.recent.size > 2000) for (const [k, until] of room.recent) if (until < now) room.recent.delete(k);
    if (puts.length === 0 && dels.length === 0) return;
    // big batches (an import) go out in several frames
    let i = 0;
    do {
      const last = i + ROWS_PER_FRAME >= puts.length;
      broadcast(room, { t: "elements", cursor: room.lastSeq, puts: puts.slice(i, i + ROWS_PER_FRAME), dels: last ? dels : [] });
      i += ROWS_PER_FRAME;
    } while (i < puts.length);
  };

  const nudge = (room: Room, topic: "comments" | "slate") => {
    const now = Date.now();
    if ((room.nudgeAt.get(topic) ?? 0) > now - 150) return;
    room.nudgeAt.set(topic, now);
    broadcast(room, { t: "nudge", topic });
  };

  /** Pulls whatever changed since the last push from the database (used by the poll feed, after a stream restart, and as a safety net). */
  const catchUp = async (room: Room) => {
    try {
      const slate = await loadSlate(room.slateId);
      if (!slate) return;
      const { rows } = await readChangeRows(slate, room.lastSeq);
      for (const r of rows) pushRow(room, r);
    } catch (e) {
      log.warn("[realtime] catch-up failed:", e instanceof Error ? e.message : e);
    }
  };
  const catchUpAll = () => Promise.all(Array.from(rooms.values()).map(catchUp));

  /* ----------------------------------------------------------------------- access */

  const recheckRoom = async (room: Room) => {
    const slate = await loadSlate(room.slateId).catch(() => null);
    for (const c of Array.from(room.conns)) {
      const access = slate ? await resolveAccess(c.ctx, slate).catch(() => c.access) : null;
      if (!access) {
        send(c, { t: "revoked" });
        leaveRoom(c);
      } else if (c.access && access.level !== c.access.level) {
        c.access = access;
        send(c, { t: "access", access: access.level });
      } else {
        c.access = access;
      }
    }
  };
  const recheckSoon = (room: Room) => {
    if (room.recheckTimer) return;
    room.recheckTimer = setTimeout(() => {
      room.recheckTimer = null;
      void recheckRoom(room);
    }, 250);
  };
  const sweepAccess = async () => {
    await Promise.all(Array.from(rooms.values()).map(recheckRoom));
  };

  /* ----------------------------------------------------------------- change sources */

  const onElementChange = (change: ChangeStreamDocument<Document>) => {
    const doc = "fullDocument" in change ? (change.fullDocument as (ChangeRow & { slateId: string }) | null | undefined) : null;
    if (!doc) return;
    const room = rooms.get(doc.slateId);
    if (room) pushRow(room, doc);
  };

  const onCommentChange = (change: ChangeStreamDocument<Document>) => {
    const doc = "fullDocument" in change ? (change.fullDocument as { slateId?: string } | null | undefined) : null;
    if (doc?.slateId) {
      const room = rooms.get(doc.slateId);
      if (room) nudge(room, "comments");
    } else {
      for (const room of rooms.values()) nudge(room, "comments"); // a delete does not say which board
    }
  };

  const onSlateChange = (change: ChangeStreamDocument<Document>) => {
    if (change.operationType !== "update") return;
    const room = rooms.get(String(change.documentKey._id));
    if (!room) return;
    nudge(room, "slate");
    recheckSoon(room);
  };

  /** One MongoDB change stream that restarts itself (with backoff, and a catch-up of what it missed) if it ever drops. */
  interface Watcher {
    name: string;
    open: (c: Collections) => ChangeStream;
    handle: (change: ChangeStreamDocument<Document>) => void;
    stream: ChangeStream | null;
    restart: ReturnType<typeof setTimeout> | null;
    failures: number;
  }

  const watchers: Watcher[] = [
    {
      name: "elements",
      // the whole row is needed (an update only reports the fields it touched)
      open: (c) => c.elements.watch([{ $match: { operationType: { $in: ["insert", "update", "replace"] } } }], { fullDocument: "updateLookup", maxAwaitTimeMS: 200 }) as unknown as ChangeStream,
      handle: onElementChange,
      stream: null,
      restart: null,
      failures: 0,
    },
    {
      name: "comments",
      open: (c) => c.db.watch([{ $match: { "ns.coll": { $in: ["commentThreads", "comments"] } } }], { fullDocument: "updateLookup", maxAwaitTimeMS: 200 }),
      handle: onCommentChange,
      stream: null,
      restart: null,
      failures: 0,
    },
    {
      name: "slates",
      // only edits to a board's settings, and no document lookup: every edit also bumps the board's change counter, and its text can be large
      open: (c) =>
        c.slates.watch(
          [
            {
              $match: {
                operationType: "update",
                $or: [...slateSettingFields.map((f) => ({ [`updateDescription.updatedFields.${f}`]: { $exists: true } })), { "updateDescription.removedFields": { $in: slateSettingFields } }],
              },
            },
          ],
          { maxAwaitTimeMS: 200 }
        ) as unknown as ChangeStream,
      handle: onSlateChange,
      stream: null,
      restart: null,
      failures: 0,
    },
  ];

  const attach = async (w: Watcher) => {
    const s = w.open(await getCollections());
    // sends the request now, so "this database has no change streams" fails here instead of later
    const first = await s.tryNext();
    if (first) w.handle(first);
    w.stream = s;
    void (async () => {
      try {
        for await (const change of s) w.handle(change);
      } catch (e) {
        if (!closed && w.stream === s) log.warn(`[realtime] ${w.name} change stream error:`, e instanceof Error ? e.message : e);
      }
      if (!closed && w.stream === s) scheduleRestart(w); // it ended without us closing it
    })();
  };

  const scheduleRestart = (w: Watcher) => {
    if (closed || w.restart) return;
    const old = w.stream;
    w.stream = null;
    old?.close().catch(() => undefined);
    w.failures += 1;
    w.restart = setTimeout(async () => {
      w.restart = null;
      try {
        await attach(w);
        w.failures = 0;
        void catchUpAll(); // whatever happened while it was down
      } catch {
        scheduleRestart(w);
      }
    }, Math.min(30_000, 500 * 2 ** Math.min(w.failures, 6)));
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let safetyTimer: ReturnType<typeof setInterval> | null = null;

  const mode = opts.changeFeed ?? "auto";
  let feed: "stream" | "poll" = "poll";
  if (mode !== "poll") {
    try {
      for (const w of watchers) await attach(w);
      feed = "stream";
    } catch (e) {
      for (const w of watchers) await w.stream?.close().catch(() => undefined);
      for (const w of watchers) w.stream = null;
      if (mode === "stream") throw e;
      log.warn("[realtime] change streams are not available here, polling the database instead:", e instanceof Error ? e.message : e);
    }
  }
  if (feed === "poll") {
    pollTimer = setInterval(() => void catchUpAll(), opts.pollMs ?? 400);
    pollTimer.unref();
  } else {
    // a missed event must not leave a board wrong for long
    safetyTimer = setInterval(() => void catchUpAll(), SAFETY_CATCHUP_MS);
    safetyTimer.unref();
  }

  /* ------------------------------------------------------------------- message handlers */

  const ctxFor = (userId: string | null): Ctx => {
    let profile: ReturnType<typeof ensureUser> | null = null;
    return {
      userId,
      profile: () => (userId ? (profile ??= ensureUser(userId)) : Promise.resolve(null)),
      defer: (task) => {
        void task().catch((e) => log.error("[realtime] deferred task failed:", e instanceof Error ? e.message : e));
      },
    };
  };

  const onJoin = async (c: Conn, msg: Extract<ClientMsg, { t: "join" }>) => {
    leaveRoom(c);
    let userId: string | null = null;
    if (msg.token) {
      const verified = await opts.verifyToken(msg.token).catch(() => null);
      if (!verified) return send(c, { t: "denied", reason: "auth", message: "Your sign-in could not be verified. Refresh the page." });
      userId = verified.userId;
    }
    c.ctx = ctxFor(userId);
    const slate = await loadSlate(msg.slateId);
    if (!slate) return send(c, { t: "denied", reason: "missing", message: "This board does not exist." });
    const access = await resolveAccess(c.ctx, slate);
    if (!access) return send(c, { t: "denied", reason: "access", message: "You don't have access to this board." });
    if (!open(c)) return; // gone while we were checking

    const room = rooms.get(slate._id) ?? createRoom(slate);
    // the same tab reconnecting before its old socket was noticed dead: the old one goes
    for (const other of Array.from(room.conns)) {
      if (other !== c && other.session?.id === msg.session.id) {
        leaveRoom(other);
        other.ws.close(CLOSE_REPLACED, "replaced by a newer connection");
      }
    }
    const now = Date.now();
    c.access = access;
    c.room = room;
    c.session = {
      id: msg.session.id,
      userId: userId ?? `anon:${msg.session.id}`,
      name: cleanName(msg.session.name),
      avatar: cleanAvatar(msg.session.avatar),
      color: cleanColor(msg.session.color),
      cursor: null,
      selection: [],
      lastSeen: now,
    };
    const peers = Array.from(room.conns).flatMap((o) => (o.session ? [wire(o.session)] : []));
    room.conns.add(c);
    send(c, { t: "joined", sessionId: c.session.id, access: access.level, peers, nudges: feed === "stream" });
    broadcast(room, { t: "peer", peer: wire(c.session) }, c);

    const changes = await readChanges(slate, msg.since ?? 0);
    send(c, { t: "sync", ...changes });
  };

  const onSync = async (c: Conn, since: number) => {
    if (!c.room) return send(c, { t: "error", message: "Join a board first." });
    const slate = await loadSlate(c.room.slateId);
    if (!slate) {
      send(c, { t: "revoked" });
      return leaveRoom(c);
    }
    send(c, { t: "sync", ...(await readChanges(slate, since)) });
  };

  const onOps = async (c: Conn, id: number, ops: unknown[]) => {
    if (!c.room) return send(c, { t: "error", id, message: "Join a board first." });
    const fn = lookup("elements.apply");
    if (!fn) return send(c, { t: "error", id, message: "Writes are unavailable." });
    try {
      const res = (await invoke(fn, c.ctx, { slateId: c.room.slateId, ops })) as { applied: number };
      send(c, { t: "ack", id, applied: res.applied });
    } catch (e) {
      if (e instanceof AppError) return send(c, { t: "error", id, message: e.message });
      log.error("[realtime] ops failed:", e);
      send(c, { t: "error", id, message: "Something went wrong. Please try again." });
    }
  };

  const onPresence = (c: Conn, msg: Extract<ClientMsg, { t: "presence" }>) => {
    if (!c.room || !c.session) return;
    const clean = cleanPresence(msg);
    const s = c.session;
    s.cursor = clean.cursor;
    s.selection = clean.selection;
    s.draft = clean.draft;
    s.drag = clean.drag;
    s.tool = clean.tool;
    s.lastSeen = Date.now();
    broadcast(c.room, { t: "peer", peer: wire(s) }, c, true);
  };

  const handle = async (c: Conn, raw: RawData, isBinary: boolean) => {
    c.alive = true;
    if (isBinary) return;
    // flood control: cursors beyond the allowance are dropped silently, everything else is told to slow down
    const now = Date.now();
    c.bucket.tokens = Math.min(BUCKET.capacity, c.bucket.tokens + ((now - c.bucket.at) / 1000) * BUCKET.perSecond);
    c.bucket.at = now;
    let parsed: ClientMsg;
    try {
      parsed = clientMessage.parse(JSON.parse(raw.toString()));
      c.bad = 0;
    } catch {
      send(c, { t: "error", message: "Unrecognised message." });
      if (++c.bad > 10) c.ws.close(CLOSE_BAD_MESSAGE, "too many bad messages");
      return;
    }
    if (c.bucket.tokens < 1) {
      if (parsed.t !== "presence") send(c, { t: "error", ...(parsed.t === "ops" ? { id: parsed.id } : {}), message: "You're sending too fast. Slow down." });
      return;
    }
    c.bucket.tokens -= 1;

    switch (parsed.t) {
      case "join":
        return await onJoin(c, parsed);
      case "sync":
        return await onSync(c, parsed.since);
      case "ops":
        return await onOps(c, parsed.id, parsed.ops);
      case "presence":
        return onPresence(c, parsed);
      case "leave":
        return leaveRoom(c);
    }
  };

  /* ----------------------------------------------------------------------- the server */

  const http: Server = createServer((req, res) => {
    if (req.method === "GET" && req.url?.split("?")[0] === "/health") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true, sockets: conns.size, rooms: rooms.size, feed }));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Slate realtime server. Connect with a WebSocket to /ws.");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: { threshold: 1024, concurrencyLimit: 8 } });

  const clientIp = (req: IncomingMessage) => {
    if (opts.trustProxy) {
      const fwd = req.headers["x-forwarded-for"];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? "unknown";
  };

  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") return reject("404 Not Found");
    const origins = opts.allowedOrigins ?? [];
    if (origins.length > 0 && !origins.includes(req.headers.origin ?? "")) return reject("403 Forbidden");
    const ip = clientIp(req);
    if ((perIp.get(ip) ?? 0) >= maxPerIp) return reject("429 Too Many Requests");
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const ip = clientIp(req);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const c: Conn = { ws, ip, ctx: ctxFor(null), room: null, session: null, access: null, alive: true, chain: Promise.resolve(), queued: 0, bad: 0, bucket: { tokens: BUCKET.capacity, at: Date.now() } };
    conns.add(c);

    ws.on("message", (raw, isBinary) => {
      if (c.queued > 200) return void ws.close(CLOSE_TOO_MANY, "too many queued messages");
      c.queued++;
      c.chain = c.chain
        .then(() => handle(c, raw, isBinary))
        .catch((e) => log.error("[realtime] handler failed:", e instanceof Error ? e.message : e))
        .finally(() => void c.queued--);
    });
    ws.on("pong", () => {
      c.alive = true;
    });
    ws.on("error", () => undefined); // a reset connection also fires "close"
    ws.on("close", () => {
      conns.delete(c);
      const n = (perIp.get(c.ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(c.ip);
      else perIp.set(c.ip, n);
      leaveRoom(c);
    });
  });

  // dead connections (a closed laptop, a lost network) never say goodbye: ping, and drop what doesn't answer
  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      if (open(c)) {
        c.ws.ping();
        send(c, { t: "hb" });
      }
    }
  }, opts.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();
  const recheck = setInterval(() => void sweepAccess(), opts.accessRecheckMs ?? 30_000);
  recheck.unref();

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port ?? 0, opts.host, () => resolve());
  });
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
  log.info(`[realtime] listening on :${port} (${feed === "stream" ? "change stream" : "polling"} feed)`);

  return {
    port,
    feed,
    stats: () => ({ sockets: conns.size, rooms: rooms.size, feed }),
    sweepAccess,
    close: async () => {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(recheck);
      if (pollTimer) clearInterval(pollTimer);
      if (safetyTimer) clearInterval(safetyTimer);
      for (const w of watchers) if (w.restart) clearTimeout(w.restart);
      for (const room of Array.from(rooms.values())) destroyRoom(room);
      for (const c of conns) c.ws.terminate();
      await Promise.all(watchers.map((w) => w.stream?.close().catch(() => undefined)));
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
