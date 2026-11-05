import { connectorConfig } from "../config";
import { registry } from "./index";
import { buildManifest, type Manifest } from "./manifest";
import { buildOpenApi, type OpenApiDocument } from "./openapi";

let memo: { baseUrl: string; manifest: Manifest; openapi: OpenApiDocument } | null = null;

/** The generated documents. Building them converts every schema, so they are kept until the base URL changes. */
export function connectorDocuments(): { manifest: Manifest; openapi: OpenApiDocument } {
  const config = connectorConfig();
  if (!memo || memo.baseUrl !== config.baseUrl) {
    memo = { baseUrl: config.baseUrl, manifest: buildManifest(registry, config), openapi: buildOpenApi(registry, config) };
  }
  return memo;
}
