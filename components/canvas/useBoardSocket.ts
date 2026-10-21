"use client";

import * as React from "react";
import { useAuth } from "@clerk/nextjs";
import { newId } from "@/lib/canvas/ids";
import { colorFor } from "@/lib/canvas/peers";
import { refetchQueries, setServerPush } from "@/lib/client/query";
import { BoardSocket, realtimeUrl, type SocketInfo, type SocketStatus } from "@/lib/client/realtime";

export interface PresenceIdentity {
  userId: string | null;
  name: string;
  avatar?: string;
}

export interface BoardConnection {
  /** null when this deployment has no realtime server (the page then runs on HTTP polling alone). */
  socket: BoardSocket | null;
  status: SocketStatus;
  info: SocketInfo | null;
  /** This tab's identity on the board. */
  sessionId: string;
  color: string;
}

/**
 * Opens the board's WebSocket (see `lib/realtime/server.ts`) and keeps it alive while the page is open.
 * It is an upgrade, not a requirement: `useBoardSync` and `useBoardPresence` keep working over HTTP whenever
 * `status` is not "open", so a missing or restarting realtime server never breaks a board.
 */
export function useBoardSocket(slateId: string, enabled: boolean, who: PresenceIdentity): BoardConnection {
  const { isLoaded, userId, getToken } = useAuth();
  const sessionId = React.useMemo(() => newId("t"), []);
  const color = React.useMemo(() => colorFor(who.userId ?? sessionId), [who.userId, sessionId]);
  const [socket, setSocket] = React.useState<BoardSocket | null>(null);
  const [state, setState] = React.useState<{ status: SocketStatus; info: SocketInfo | null }>({ status: "idle", info: null });

  // the latest values, read when connecting without re-creating the socket
  const latest = React.useRef({ getToken, name: who.name, avatar: who.avatar, color });
  React.useEffect(() => {
    latest.current = { getToken, name: who.name, avatar: who.avatar, color };
  });

  const url = React.useMemo(() => realtimeUrl(), []);

  // `userId` is a dependency on purpose: signing in or out must open a new connection with the new identity
  React.useEffect(() => {
    if (!enabled || !isLoaded || !url) return;
    const s = new BoardSocket({
      url,
      slateId,
      session: { id: sessionId, name: latest.current.name, avatar: latest.current.avatar, color: latest.current.color },
      getToken: () => latest.current.getToken(),
    });
    const off = s.subscribe({
      status: (status, info) => {
        setState({ status, info });
        setServerPush(status === "open" && !!info?.nudges);
      },
      nudge: (topic) => refetchQueries(topic === "comments" ? "comments." : "slates.getById"),
      // rights changed or were withdrawn: the page re-reads who it is on this board
      access: () => refetchQueries("slates.getById"),
      revoked: () => refetchQueries("slates.getById"),
    });
    setSocket(s);
    s.start();
    return () => {
      off();
      s.stop();
      setServerPush(false);
      setSocket(null);
      setState({ status: "idle", info: null });
    };
  }, [enabled, isLoaded, url, slateId, sessionId, userId]);

  React.useEffect(() => {
    socket?.updateSession({ id: sessionId, name: who.name, avatar: who.avatar, color });
  }, [socket, sessionId, who.name, who.avatar, color]);

  return { socket, status: state.status, info: state.info, sessionId, color };
}
