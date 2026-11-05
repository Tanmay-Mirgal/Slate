"use server";

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { connectorEnabled } from "@/lib/connector/config";
import { redirectWith } from "@/lib/connector/oauth/authorize";
import { verifyConsent } from "@/lib/connector/oauth/consent";
import { createAuthCode } from "@/lib/connector/oauth/grants";
import { roleSatisfies } from "@/lib/connector/scopes";
import { membershipOf } from "@/lib/server/access";

/**
 * The consent form's submit. Nothing in the form is trusted: the request comes from the signed blob (bound to
 * the signed-in user), the workspace choice is checked against the user's real membership and role, and only
 * then is a single-use code created and the browser sent back to the Hub.
 */
export async function decide(formData: FormData): Promise<void> {
  if (!connectorEnabled()) notFound();
  const { userId } = await auth();
  if (!userId) redirect("/auth?mode=sign-in");

  const request = verifyConsent(String(formData.get("consent") ?? ""), userId);
  if (!request) redirect("/connect/authorize?connect_error=expired");

  if (formData.get("decision") !== "allow") {
    redirect(redirectWith(request.redirectUri, { error: "access_denied", error_description: "The user denied the request", state: request.state }));
  }

  const workspaceId = String(formData.get("workspaceId") ?? "");
  const membership = workspaceId ? await membershipOf(workspaceId, userId) : null;
  if (!membership || !roleSatisfies(membership.role, request.scopes)) redirect("/connect/authorize?connect_error=workspace");

  const code = await createAuthCode({
    clientId: request.clientId,
    userId,
    workspaceId,
    scopes: request.scopes,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
  });
  redirect(redirectWith(request.redirectUri, { code, state: request.state }));
}
