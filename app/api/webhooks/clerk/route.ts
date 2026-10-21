import { Webhook } from "svix";
import { ensureDefaultWorkspace, deleteUser, profileFromWebhook, upsertUser, type WebhookUserData } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClerkEvent {
  type: string;
  data: { id?: string } & Record<string, unknown>;
}

/**
 * POST /api/webhooks/clerk
 * Keeps MongoDB in step with Clerk. In the Clerk dashboard (Webhooks) add an endpoint that points
 * here, subscribe it to user.created, user.updated and user.deleted, and put its signing secret in
 * CLERK_WEBHOOK_SECRET. The app also creates a missing user the first time they sign in, so a delayed
 * or missing webhook never blocks anyone; the webhook is what propagates later profile edits.
 */
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk webhook] CLERK_WEBHOOK_SECRET is not set");
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signature = req.headers.get("svix-signature");
  if (!id || !timestamp || !signature) return new Response("Missing svix headers", { status: 400 });

  const raw = await req.text();
  let event: ClerkEvent;
  try {
    event = new Webhook(secret).verify(raw, { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature }) as ClerkEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const clerkId = event.data?.id;
  if (!clerkId) return new Response("ignored", { status: 200 });

  try {
    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const user = await upsertUser(clerkId, profileFromWebhook(event.data as WebhookUserData));
        if (event.type === "user.created") await ensureDefaultWorkspace(clerkId, user);
        break;
      }
      case "user.deleted":
        await deleteUser(clerkId);
        break;
      default:
        break;
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    // a 5xx makes Clerk retry the delivery
    console.error("[clerk webhook] could not apply", event.type, e);
    return new Response("Could not apply the event", { status: 500 });
  }
}
