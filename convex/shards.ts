/**
 * Element rows are spread over a fixed number of shards so each client subscribes to SHARD_COUNT
 * small queries rather than one large one. Dependency-free on purpose: imported by both the Convex
 * functions and the browser client. Changing SHARD_COUNT requires re-sharding existing rows.
 */
export const SHARD_COUNT = 4;

export function shardOf(id: string, shards: number = SHARD_COUNT): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % shards;
}
