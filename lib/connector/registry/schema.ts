import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

/**
 * JSON Schema 2020-12 for a zod schema. `title`, `description`, `enum`, `default`, `minLength`/`maxLength` and
 * `examples` set in the zod schema (`.meta()`, `.default()`, `.max()`...) come through, which is what lets the Hub
 * render its workflow forms straight from the manifest.
 *
 *   io "input"  - what a caller may send (fields with defaults are optional)
 *   io "output" - what a caller receives (fields with defaults are present)
 */
export function toJsonSchema(schema: z.ZodType, io: "input" | "output" = "input"): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  return json;
}

/** Page envelope shared by every list endpoint. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().describe("Pass as ?cursor= to get the next page; null on the last page"),
  });

/** Query parameters shared by every list endpoint. */
export const paginationQuery = {
  limit: z.coerce.number().int().min(1).max(200).default(50).meta({ title: "Page size", description: "Items per page (max 200)" }),
  cursor: z.string().max(512).optional().meta({ title: "Cursor", description: "Opaque cursor from the previous page's nextCursor" }),
};

export const externalRefSchema = z
  .strictObject({
    hubProjectId: z.string().max(64).optional(),
    hubRunId: z.string().max(64).optional(),
    hubStepId: z.string().max(64).optional(),
  })
  .meta({
    title: "External reference",
    description: "Correlation ids from the caller's workflow. Stored on what the action creates and echoed in every event about it.",
    examples: [{ hubProjectId: "prj_123", hubRunId: "run_456", hubStepId: "step_design" }],
  });

/** Caller-defined data kept with an entity (<= 2 KB once serialised). */
export const metadataSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 2048, "metadata must be at most 2 KB")
  .meta({ title: "Metadata", description: "Free-form object (max 2 KB) stored with the entity and returned as-is." });
