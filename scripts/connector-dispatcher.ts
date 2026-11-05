/**
 * The ecosystem connector's background worker: delivers webhooks (with retries), fans events out to the endpoints
 * that should get them, and finishes asynchronous operations whose request died. Run it as its own service when
 * CONNECTOR_DISPATCHER=external; with "inline" the realtime server runs the same loop and this script is not needed.
 *
 *   npm run connector:dispatcher
 *
 * Needs MONGODB_URI and the CONNECTOR_* settings (see .env.example). Any number of copies can run at once.
 */
import { assertConnectorEnv, connectorEnabled } from "@/lib/connector/config";
import { startDispatcher } from "@/lib/connector/events/dispatcher";
import { closeMongo } from "@/lib/db/mongo";

async function main() {
  if (!connectorEnabled()) {
    console.info("[connector] CONNECTOR_ENABLED is not true: nothing to run.");
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  assertConnectorEnv();

  const dispatcher = startDispatcher({ log: console });
  const stop = async (signal: string) => {
    console.info(`[connector] ${signal}: shutting down`);
    await dispatcher.stop().catch(() => undefined);
    await closeMongo().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

main().catch((e) => {
  console.error("[connector] dispatcher could not start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
