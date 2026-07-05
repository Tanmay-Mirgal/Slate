import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Webhook } from "svix";

const http = httpRouter();

http.route({
  path: "/clerk",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = request.headers;
    const svixId = headers.get("svix-id");
    const svixTimestamp = headers.get("svix-timestamp");
    const svixSignature = headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    const textBody = await request.text();
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.error("Missing CLERK_WEBHOOK_SECRET in Convex Dashboard environment variables.");
      return new Response("Webhook secret not configured in Convex dashboard", { status: 500 });
    }

    try {
      const wh = new Webhook(webhookSecret);
      const payload = wh.verify(textBody, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as any;

      const eventType = payload.type;
      const data = payload.data;

      if (eventType === "user.created") {
        const email = data.email_addresses?.[0]?.email_address || "";
        await ctx.runMutation(api.users.createUser, {
          clerkId: data.id,
          email,
          firstName: data.first_name || null,
          lastName: data.last_name || null,
          imageUrl: data.image_url || null,
        });
      } else if (eventType === "user.updated") {
        const email = data.email_addresses?.[0]?.email_address || "";
        await ctx.runMutation(api.users.updateUser, {
          clerkId: data.id,
          email,
          firstName: data.first_name || null,
          lastName: data.last_name || null,
          imageUrl: data.image_url || null,
        });
      } else if (eventType === "user.deleted") {
        await ctx.runMutation(api.users.deleteUser, {
          clerkId: data.id,
        });
      }

      return new Response("Success", { status: 200 });
    } catch (err) {
      console.error("Webhook verification failed:", err);
      return new Response("Webhook verification failed", { status: 400 });
    }
  }),
});

export default http;
