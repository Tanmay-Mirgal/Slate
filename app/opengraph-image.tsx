import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OG_ALT, OG_SIZE, SITE_NAME, SITE_URL } from "@/lib/seo";

// The card shown when a Slate link is pasted into Slack, X, LinkedIn, WhatsApp, Discord... (1200x630 is the 1.91:1 standard).
export const alt = OG_ALT;
export const size = { ...OG_SIZE };
export const contentType = "image/png";

const dataUri = async (file: string, mime: string) =>
  `data:${mime};base64,${(await readFile(join(process.cwd(), "public", file))).toString("base64")}`;

const CHIPS = ["AI diagrams", "Diagram as code", "Live collaboration"];

export default async function Image() {
  const [logo, product] = await Promise.all([dataUri("icons/icon-192.png", "image/png"), dataUri("slate-how-to-poster.jpg", "image/jpeg")]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 64px",
          color: "white",
          background: "#0A0A0A",
          backgroundImage:
            "radial-gradient(circle at 12% 8%, rgba(124,58,237,0.38), rgba(10,10,10,0) 46%), radial-gradient(circle at 92% 92%, rgba(59,130,246,0.30), rgba(10,10,10,0) 46%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={56} height={56} alt="" style={{ borderRadius: 14 }} />
          <div style={{ display: "flex", marginLeft: 16, fontSize: 34, letterSpacing: 4 }}>{SITE_NAME.toUpperCase()}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 500 }}>
            <div style={{ display: "flex", fontSize: 76, lineHeight: 1.04, letterSpacing: -2 }}>Think.</div>
            <div style={{ display: "flex", fontSize: 76, lineHeight: 1.04, letterSpacing: -2 }}>Draw.</div>
            <div style={{ display: "flex", fontSize: 76, lineHeight: 1.04, letterSpacing: -2, color: "#A78BFA" }}>Collaborate.</div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 27, lineHeight: 1.35, color: "#A0A0A0" }}>
              AI architecture diagrams and markdown docs on one real-time whiteboard.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              width: 540,
              height: 304,
              borderRadius: 20,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.16)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={product} width={540} height={304} alt="" style={{ objectFit: "cover" }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex" }}>
            {CHIPS.map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  marginRight: 12,
                  padding: "8px 18px",
                  fontSize: 22,
                  color: "#E0E0E0",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.05)",
                }}
              >
                {chip}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#808080" }}>{SITE_URL.replace(/^https?:\/\//, "")}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
