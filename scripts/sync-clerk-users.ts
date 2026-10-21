/**
 * Copies every Clerk user into MongoDB (and gives each one a workspace if they have none), so the two
 * agree even if the Clerk webhook was not set up when some people signed up.
 *
 *   npm run clerk:sync              # sync
 *   npm run clerk:sync -- --dry-run # only report what would change
 *
 * Read-only towards Clerk. Towards MongoDB it only adds or refreshes profile fields: billing state,
 * boards and memberships are never touched, and nothing is deleted (users that exist in MongoDB but
 * no longer in Clerk are listed so you can decide).
 */
import { createClerkClient } from "@clerk/nextjs/server";
import { closeMongo, getCollections } from "@/lib/db/mongo";
import { ensureDefaultWorkspace, profileFromClerk, upsertUser } from "@/lib/server/users";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set (.env.local).");
  const clerk = createClerkClient({ secretKey });
  const c = await getCollections();

  let seen = 0;
  let created = 0;
  let updated = 0;
  let workspacesMade = 0;
  const clerkIds = new Set<string>();

  for (let offset = 0; ; offset += 100) {
    const page = await clerk.users.getUserList({ limit: 100, offset, orderBy: "+created_at" });
    for (const u of page.data) {
      seen++;
      clerkIds.add(u.id);
      const profile = profileFromClerk(u);
      const before = await c.users.findOne({ clerkId: u.id });
      const changed = !before || before.email !== profile.email || before.firstName !== profile.firstName || before.lastName !== profile.lastName || before.imageUrl !== profile.imageUrl || (before.emails ?? []).join() !== profile.emails.slice().sort().join();
      if (!before) created++;
      else if (changed) updated++;
      if (dryRun) {
        if (!(await c.workspaces.findOne({ ownerId: u.id }, { projection: { _id: 1 } }))) workspacesMade++;
        continue;
      }
      const row = await upsertUser(u.id, profile);
      const had = await c.workspaces.findOne({ ownerId: u.id }, { projection: { _id: 1 } });
      if (!had) {
        await ensureDefaultWorkspace(u.id, row);
        workspacesMade++;
      }
    }
    if (page.data.length < 100) break;
  }

  const stale = (await c.users.find({}, { projection: { clerkId: 1 } }).toArray()).filter((u) => !clerkIds.has(u.clerkId));
  console.log(`${dryRun ? "DRY RUN — " : ""}Clerk users: ${seen}`);
  console.log(`  new in MongoDB:      ${created}`);
  console.log(`  profile refreshed:   ${updated}`);
  console.log(`  default workspaces:  ${workspacesMade} ${dryRun ? "to create" : "created"}`);
  console.log(`  in MongoDB but no longer in Clerk: ${stale.length}${stale.length ? " (kept; delete by hand if they are test accounts)" : ""}`);
  for (const s of stale.slice(0, 10)) console.log(`    - ${s.clerkId}`);
}

main()
  .catch((e) => {
    console.error("\n✖", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
