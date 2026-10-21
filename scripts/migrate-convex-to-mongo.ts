/**
 * One-time copy of a Convex snapshot export into MongoDB.
 *
 *   npx convex export --path backups/convex.zip        # 1. take the backup (read-only)
 *   (unzip it into its own folder)                      # 2.
 *   npm run db:migrate -- backups/convex -- --dry-run   # 3. see what would happen
 *   npm run db:migrate -- backups/convex                # 4. copy it
 *
 * Safe to run again: rows are inserted only when their _id is not in MongoDB yet, so nothing already
 * there (including edits made after the move) is ever overwritten. It never drops or deletes anything.
 * At the end every copied row is read back and compared with the export.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AnyBulkWriteOperation, Document } from "mongodb";
import { closeMongo, getCollections } from "@/lib/db/mongo";
import { BadRow, CONVEX_STORAGE_URL, COLLECTION_OF, COPIED_TABLES, mapRow, SKIPPED_TABLES, type CopiedTable, type Row } from "@/lib/db/convex-import";

const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const dir = args.find((a) => !a.startsWith("--"));
const BATCH = 400;

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

if (!dir) fail("Usage: npm run db:migrate -- <folder of the unzipped Convex export> [--dry-run]");
const root = resolve(dir);
if (!existsSync(root) || !statSync(root).isDirectory()) fail(`${root} is not a folder. Unzip the export first.`);

async function* rows(table: string): AsyncGenerator<Row> {
  const file = join(root, table, "documents.jsonl");
  if (!existsSync(file)) return;
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    n++;
    try {
      yield JSON.parse(line) as Row;
    } catch {
      fail(`${table}/documents.jsonl line ${n} is not valid JSON`);
    }
  }
}

const fingerprint = (parts: string[]) => createHash("sha256").update(parts.sort().join("\n")).digest("hex").slice(0, 16);

interface Report {
  table: string;
  source: number;
  skipped: number;
  inserted: number;
  existing: number;
  rejected: number;
  verified: boolean;
}

async function main() {
  console.log(`${dryRun ? "DRY RUN — nothing will be written.\n" : ""}Source: ${root}`);

  // Refuse to proceed if the data points at Convex file storage: those files would be lost.
  const storageDir = join(root, "_storage");
  if (existsSync(storageDir) && readdirSync(storageDir).some((f) => f !== "documents.jsonl")) {
    fail("This export contains Convex file storage. Copy the files (and rewrite their links) before migrating; this script does not do that.");
  }
  for (const table of COPIED_TABLES) {
    for await (const row of rows(table)) {
      const text = JSON.stringify(row);
      if (CONVEX_STORAGE_URL.test(text)) fail(`${table}/${String(row._id)} links to Convex file storage, which is not migrated.`);
    }
  }

  const c = await getCollections();
  const mongoOf = (table: CopiedTable) => c.db.collection(COLLECTION_OF[table]);
  const reports: Report[] = [];
  const problems: string[] = [];

  /** per board: highest change number in use, so elements get numbers after anything already there */
  const seqBase = new Map<string, number>();
  const sourceFingerprints = new Map<string, string[]>(); // table -> per-row fingerprints, for the read-back check

  for (const table of COPIED_TABLES) {
    const coll = mongoOf(table);
    const rep: Report = { table, source: 0, skipped: 0, inserted: 0, existing: 0, rejected: 0, verified: false };
    const mapped: Document[] = [];

    // elements are numbered per board in their original creation order
    const source: Row[] = [];
    for await (const row of rows(table)) source.push(row);
    if (table === "elements") source.sort((a, b) => Number(a._creationTime) - Number(b._creationTime));

    const seen = new Set<string>();
    for (const row of source) {
      rep.source++;
      let result;
      try {
        result = mapRow(table, row);
      } catch (e) {
        if (e instanceof BadRow) {
          rep.rejected++;
          problems.push(e.message);
          continue;
        }
        throw e;
      }
      if ("skip" in result) {
        rep.skipped++;
        continue;
      }
      const doc = result.doc;
      if (seen.has(String(doc._id))) {
        rep.rejected++;
        problems.push(`${table}: duplicate _id ${String(doc._id)}`);
        continue;
      }
      seen.add(String(doc._id));
      if (table === "elements") {
        const slateId = String(doc.slateId);
        if (!seqBase.has(slateId)) {
          const top = await c.elements.find({ slateId }).sort({ seq: -1 }).limit(1).project<{ seq: number }>({ seq: 1 }).next();
          const slate = await c.slates.findOne({ _id: slateId }, { projection: { elementSeq: 1 } });
          seqBase.set(slateId, Math.max(top?.seq ?? 0, slate?.elementSeq ?? 0));
        }
        const next = seqBase.get(slateId)! + 1;
        seqBase.set(slateId, next);
        doc.seq = next;
      }
      mapped.push(doc);
    }

    // insert-only: an existing _id is left exactly as it is
    for (let i = 0; i < mapped.length; i += BATCH) {
      const batch = mapped.slice(i, i + BATCH);
      if (dryRun) {
        const have = await coll.countDocuments({ _id: { $in: batch.map((d) => d._id) } as never });
        rep.existing += have;
        rep.inserted += batch.length - have;
        continue;
      }
      const ops: AnyBulkWriteOperation<Document>[] = batch.map((d) => ({ updateOne: { filter: { _id: d._id as never }, update: { $setOnInsert: d }, upsert: true } }));
      try {
        const res = await coll.bulkWrite(ops, { ordered: false });
        rep.inserted += res.upsertedCount;
        rep.existing += res.matchedCount;
      } catch (e) {
        const err = e as { code?: number; writeErrors?: { errmsg?: string }[]; result?: { upsertedCount?: number; matchedCount?: number } };
        if (err.code !== 11000 && !err.writeErrors) throw e;
        // a unique index (e.g. one user per Clerk id, one element per board+eid) rejected some rows: report, keep the rest
        const bad = err.writeErrors?.length ?? 0;
        rep.rejected += bad;
        rep.inserted += err.result?.upsertedCount ?? 0;
        rep.existing += err.result?.matchedCount ?? 0;
        for (const w of (err.writeErrors ?? []).slice(0, 3)) problems.push(`${table}: ${w.errmsg}`);
      }
    }

    // fingerprint of what should now be in MongoDB (for the read-back check)
    sourceFingerprints.set(
      table,
      mapped.map((d) => `${String(d._id)}:${table === "elements" ? createHash("sha1").update(String(d.data)).digest("hex") : ""}`)
    );
    if (!dryRun && table === "elements") {
      // keep each board's change counter ahead of the numbers just handed out
      const ops = Array.from(seqBase, ([slateId, seq]) => ({ updateOne: { filter: { _id: slateId as never }, update: { $max: { elementSeq: seq } } } }));
      if (ops.length) await c.db.collection("slates").bulkWrite(ops);
    }
    reports.push(rep);
    console.log(`  ${table.padEnd(18)} ${String(rep.source).padStart(5)} read, ${String(rep.inserted).padStart(5)} ${dryRun ? "to insert" : "inserted"}, ${String(rep.existing).padStart(5)} already there${rep.skipped ? `, ${rep.skipped} skipped` : ""}${rep.rejected ? `, ${rep.rejected} REJECTED` : ""}`);
  }

  for (const t of SKIPPED_TABLES) {
    let n = 0;
    for await (const row of rows(t)) if (row) n++;
    if (n) console.log(`  ${t.padEnd(18)} ${String(n).padStart(5)} not copied (temporary state)`);
  }

  if (dryRun) {
    console.log("\nDry run finished. Run again without --dry-run to copy.");
    return;
  }

  // Read everything back and compare with the export.
  console.log("\nVerifying (reading every copied row back)…");
  let ok = true;
  for (const rep of reports) {
    const expected = sourceFingerprints.get(rep.table)!;
    const ids = expected.map((x) => x.slice(0, x.indexOf(":")));
    let present = 0;
    const dataOf = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const found = await mongoOf(rep.table as CopiedTable)
        .find({ _id: { $in: ids.slice(i, i + 1000) } as never })
        .project(rep.table === "elements" ? { data: 1 } : { _id: 1 })
        .toArray();
      present += found.length;
      if (rep.table === "elements") for (const f of found) dataOf.set(String(f._id), createHash("sha1").update(String(f.data)).digest("hex"));
    }
    let intact = present === ids.length;
    if (rep.table === "elements") intact = intact && fingerprint(expected) === fingerprint(ids.map((id) => `${id}:${dataOf.get(id) ?? "MISSING"}`));
    rep.verified = intact;
    ok &&= intact;
    console.log(`  ${intact ? "✔" : "✖"} ${rep.table.padEnd(18)} ${present}/${ids.length} present${rep.table === "elements" ? ", contents identical" : ""}`);
  }

  // Cross-checks on the migrated data itself.
  const orphan = async (child: string, field: string, parent: string) => {
    const ids = (await mongoOf(parent as CopiedTable).find({}).project({ _id: 1 }).toArray()).map((d) => d._id);
    return await c.db.collection(child).countDocuments({ [field]: { $nin: ids, $exists: true } } as never);
  };
  const checks: [string, number][] = [
    ["elements whose board is missing", await orphan("elements", "slateId", "slates")],
    ["boards whose workspace is missing", await orphan("slates", "workspaceId", "workspaces")],
    ["members whose workspace is missing", await orphan("workspace_members", "workspaceId", "workspaces")],
  ];
  for (const [label, n] of checks) if (n) console.log(`  ! ${label}: ${n} (present in the source too; kept)`);

  if (problems.length) {
    console.log("\nRows that were not copied:");
    for (const p of problems.slice(0, 15)) console.log("  - " + p);
  }
  if (!ok || reports.some((r) => r.rejected > 0)) fail("Some rows are missing or differ. Nothing was deleted; fix the cause above and run again.");
  console.log("\n✔ Migration complete and verified.");
}

main()
  .catch((e) => fail(e instanceof Error ? e.message : String(e)))
  .finally(() => closeMongo());
