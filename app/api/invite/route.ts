import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req: Request) {
  try {
    const { email, role, slateTitle, workspaceName } = await req.json();

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpSecure = process.env.SMTP_SECURE === "true";

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn("SMTP credentials are not configured in environment variables.");
      return NextResponse.json(
        { error: "SMTP is not configured on the server." },
        { status: 501 }
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || "587"),
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const inviteLink = `${new URL(req.url).origin}/dashboard`;

    const htmlContent = `
      <div style="font-family: sans-serif; padding: 24px; max-width: 600px; border: 1px solid #e5e5e5; border-radius: 12px; background-color: #ffffff; color: #1a1a1a;">
        <h2 style="color: #000000; font-size: 20px; font-weight: bold; margin-bottom: 16px;">Collaborate on Slate</h2>
        <p>Hello,</p>
        <p>You have been invited to collaborate on the whiteboard slate <strong>"${slateTitle || "Untitled Slate"}"</strong> in the workspace <strong>"${workspaceName || "Slate Workspace"}"</strong> with <strong>${role}</strong> access.</p>
        <p style="margin: 32px 0;">
          <a href="${inviteLink}" style="background-color: #000000; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 13px; display: inline-block;">Accept Invitation</a>
        </p>
        <p style="color: #666666; font-size: 11px; margin-top: 24px; line-height: 1.5;">If the button above doesn't work, copy and paste this link into your browser:<br/>
        <a href="${inviteLink}" style="color: #2563eb; text-decoration: none;">${inviteLink}</a></p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Slate Whiteboard" <${smtpUser}>`,
      to: email,
      subject: `Invitation to collaborate on "${slateTitle || "Slate"}"`,
      html: htmlContent,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("SMTP error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send the invitation" }, { status: 500 });
  }
}
