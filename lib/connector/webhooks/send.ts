import http from "node:http";
import https from "node:https";
import type { WebhookTarget } from "./ssrf";

export interface SendResult {
  /** A 2xx answer. */
  ok: boolean;
  status?: number;
  /** First 2 KB of the answer, for the delivery log. */
  body?: string;
  error?: string;
  durationMs: number;
}

const CONNECT_MS = 5_000;
const TOTAL_MS = 10_000;
const MAX_BODY = 2_000;

/**
 * POSTs `body` to the checked address. 5 s to connect, 10 s in all, and redirects are never followed (a 3xx is a
 * failed delivery: following it would let an endpoint bounce the request to an address nobody checked).
 */
export function sendJson(target: WebhookTarget, headers: Record<string, string>, body: string, limits: { connectMs?: number; totalMs?: number } = {}): Promise<SendResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: Omit<SendResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      resolve({ ...r, durationMs: Date.now() - started });
    };

    const secure = target.url.protocol === "https:";
    const lib = secure ? https : http;
    const req = lib.request(
      {
        host: target.ip,
        family: target.family,
        port: target.url.port || (secure ? 443 : 80),
        method: "POST",
        path: `${target.url.pathname}${target.url.search}`,
        headers: { ...headers, Host: target.url.host, "Content-Length": Buffer.byteLength(body) },
        // TLS must still verify the certificate against the NAME, although we connect to the checked address
        ...(secure ? { servername: /^[\d.]+$|:/.test(target.url.hostname) ? undefined : target.url.hostname } : {}),
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size < MAX_BODY) chunks.push(chunk);
          size += chunk.length;
          if (size > MAX_BODY * 4) res.destroy();
        });
        const done = () => {
          const status = res.statusCode ?? 0;
          finish({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY) });
        };
        res.on("end", done);
        res.on("close", done);
        res.on("error", () => done());
      }
    );
    const total = setTimeout(() => {
      req.destroy();
      finish({ ok: false, error: "The endpoint did not answer within 10 seconds" });
    }, limits.totalMs ?? TOTAL_MS);
    req.on("socket", (socket) => {
      const connectTimer = setTimeout(() => {
        req.destroy();
        finish({ ok: false, error: "Could not connect within 5 seconds" });
      }, limits.connectMs ?? CONNECT_MS);
      socket.once(secure ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
      socket.once("close", () => clearTimeout(connectTimer));
    });
    req.on("error", (e) => finish({ ok: false, error: e.message.slice(0, 200) }));
    req.end(body);
  });
}
