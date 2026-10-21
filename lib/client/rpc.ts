/** An error from `/api/rpc`. `data` carries structured details (e.g. a billing limit) for the UI. */
export class RpcError extends Error {
  readonly data?: unknown;
  readonly status: number;
  constructor(message: string, data?: unknown, status = 0) {
    super(message);
    this.name = "RpcError";
    this.data = data;
    this.status = status;
  }
}

interface RpcBody {
  ok?: boolean;
  data?: unknown;
  error?: { message?: string; data?: unknown };
}

/** Calls a server function by name (`"slates.list"`). Prefer `useQuery` / `useMutation`; this is for hooks that manage their own loop. */
export async function rpcCall<R>(name: string, args: unknown, opts: { signal?: AbortSignal; keepalive?: boolean } = {}): Promise<R> {
  let res: Response;
  try {
    res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn: name, args }),
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
      keepalive: opts.keepalive,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new RpcError("You appear to be offline. Check your connection and try again.");
  }
  let body: RpcBody | null = null;
  try {
    body = (await res.json()) as RpcBody;
  } catch {
    /* not JSON: handled below */
  }
  if (!res.ok || !body?.ok) throw new RpcError(body?.error?.message || `The server returned an error (${res.status}).`, body?.error?.data, res.status);
  return body.data as R;
}
