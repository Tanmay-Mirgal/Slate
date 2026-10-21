/**
 * The realtime (WebSocket) server: pushes board changes and live cursors to every browser on a board.
 * A separate long-running process next to the Next.js app (a serverless host cannot hold WebSockets open).
 *
 *   npm run realtime            # development: `npm run dev` starts it for you
 *
 * Environment (all of it can come from .env.local or the host's settings):
 *   MONGODB_URI                  the same database as the app
 *   CLERK_SECRET_KEY             verifies the sign-in tokens browsers send when they join a board
 *   CLERK_JWT_KEY                optional: verify tokens without a network call to Clerk
 *   REALTIME_PORT (or PORT)      default 4000
 *   REALTIME_HOST                default: all interfaces
 *   REALTIME_ALLOWED_ORIGINS     comma separated, e.g. https://app.example.com (empty = any origin)
 *   REALTIME_TRUST_PROXY=1       read the client address from X-Forwarded-For (only behind your own proxy)
 *
 * The browsers find it through NEXT_PUBLIC_REALTIME_URL (e.g. wss://realtime.example.com).
 */
import { verifyToken } from "@clerk/nextjs/server";
import { closeMongo } from "@/lib/db/mongo";
import { startRealtimeServer } from "@/lib/realtime/server";

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const jwtKey = process.env.CLERK_JWT_KEY;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  if (!secretKey && !jwtKey) throw new Error("CLERK_SECRET_KEY (or CLERK_JWT_KEY) is not set: sign-in tokens could not be verified.");

  const origins = (process.env.REALTIME_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const server = await startRealtimeServer({
    port: Number(process.env.REALTIME_PORT ?? process.env.PORT ?? 4000),
    host: process.env.REALTIME_HOST || undefined,
    allowedOrigins: origins,
    trustProxy: process.env.REALTIME_TRUST_PROXY === "1",
    log: console,
    verifyToken: async (token) => {
      try {
        // Clerk's SDK returns { data, errors } (older versions return the payload or throw): accept all three
        const result = (await verifyToken(token, { secretKey, jwtKey, ...(origins.length ? { authorizedParties: origins } : {}) })) as unknown;
        const payload = result && typeof result === "object" && "data" in result ? (result as { data?: { sub?: string } | null }).data : (result as { sub?: string } | null);
        return payload?.sub ? { userId: payload.sub } : null;
      } catch {
        return null;
      }
    },
  });

  const stop = async (signal: string) => {
    console.info(`[realtime] ${signal}: shutting down`);
    await server.close().catch(() => undefined);
    await closeMongo().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

main().catch((e) => {
  console.error("[realtime] could not start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
