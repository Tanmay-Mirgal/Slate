/**
 * The WebSocket protocol between the browser and the realtime server (`lib/realtime/server.ts`).
 * Types only, shared by both sides. Every frame is one JSON object with a `t` (type).
 *
 * One socket follows one board:
 *
 *   client                                   server
 *   join { slateId, token?, since, session } ──►
 *                                          ◄── joined { access, peers }      (or denied)
 *                                          ◄── sync { full, cursor, puts, dels }   the board (or what changed since `since`)
 *   ops { id, ops }                        ──►
 *                                          ◄── ack { id, applied }           (or error { id, message })
 *   presence { cursor, selection, ... }    ──►  fanned out to the others as peer { ... }
 *                                          ◄── elements { cursor, puts, dels }     every change from anybody, pushed
 *                                          ◄── peer / left / access / revoked / nudge / hb
 */

export interface WireElementRow {
  eid: string;
  z: number;
  rev: number;
  /** The element as JSON. */
  data: string;
}

export interface WireOpPut {
  t: "put";
  id: string;
  z: number;
  data: string;
}
export interface WireOpDel {
  t: "del";
  id: string;
}
export type WireOp = WireOpPut | WireOpDel;

/** A person on the board, as every other person sees them. Same shape the HTTP `presence.list` returns. */
export interface PeerWire {
  sessionId: string;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
  /** JSON of the element being drawn. */
  draft?: string;
  drag?: { ids: string[]; dx: number; dy: number };
  tool?: string;
  lastSeen: number;
}

export interface SessionInfo {
  id: string;
  name: string;
  avatar?: string;
  color: string;
}

export interface PresenceState {
  cursor: { x: number; y: number } | null;
  selection: string[];
  draft?: string;
  drag?: { ids: string[]; dx: number; dy: number };
  tool?: string;
}

export type ClientMessage =
  | { t: "join"; slateId: string; token?: string | null; since?: number; session: SessionInfo }
  | { t: "sync"; since: number }
  | { t: "ops"; id: number; ops: WireOp[] }
  | ({ t: "presence" } & PresenceState)
  | { t: "leave" };

export type DeniedReason = "auth" | "access" | "missing";

export type ServerMessage =
  | { t: "joined"; sessionId: string; access: "edit" | "view"; peers: PeerWire[]; /** The server pushes `nudge`s, so comments and settings need not be polled. */ nudges: boolean }
  | { t: "denied"; reason: DeniedReason; message: string }
  | { t: "sync"; full: boolean; cursor: number; puts: WireElementRow[]; dels: string[] }
  | { t: "elements"; cursor: number; puts: WireElementRow[]; dels: string[] }
  | { t: "ack"; id: number; applied: number }
  | { t: "error"; id?: number; message: string }
  | { t: "peer"; peer: PeerWire }
  | { t: "left"; sessionId: string }
  /** The caller's rights on the board changed. */
  | { t: "access"; access: "edit" | "view" }
  /** The caller lost access to the board; the server removed them from it. */
  | { t: "revoked" }
  /** Something other than the canvas changed (comments, title, sharing): refetch it. */
  | { t: "nudge"; topic: "comments" | "slate" }
  | { t: "hb" };

/** Close codes the server uses (4000-4999 are free for applications). */
export const CLOSE_REPLACED = 4001;
export const CLOSE_TOO_MANY = 4002;
export const CLOSE_BAD_MESSAGE = 4003;
export const CLOSE_SLOW = 4004;

/** The server sends a heartbeat this often; a client that hears nothing for HEARTBEAT_TIMEOUT_MS reconnects. */
export const HEARTBEAT_MS = 20_000;
export const HEARTBEAT_TIMEOUT_MS = 55_000;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
