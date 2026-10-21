import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import type { UserDoc } from "@/lib/db/types";
import type { Ctx } from "./fn";
import { ensureUser } from "./users";

/** Builds the per-request context from the Clerk session cookie. Anonymous visitors get `userId: null`. */
export async function requestContext(): Promise<Ctx> {
  const { userId } = await auth();
  let profile: Promise<UserDoc | null> | null = null;
  return {
    userId,
    profile: () => {
      if (!userId) return Promise.resolve(null);
      profile ??= ensureUser(userId);
      return profile;
    },
    defer: (task) =>
      after(async () => {
        try {
          await task();
        } catch (e) {
          console.error("[deferred task]", e instanceof Error ? e.message : e);
        }
      }),
  };
}
