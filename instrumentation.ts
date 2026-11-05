/**
 * Runs once when the server starts. If the ecosystem connector is switched on but misconfigured, the server
 * refuses to boot with a message that lists every problem, instead of failing on the first connector request.
 * With CONNECTOR_ENABLED unset this does nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertConnectorEnv } = await import("@/lib/connector/config");
  assertConnectorEnv();
}
