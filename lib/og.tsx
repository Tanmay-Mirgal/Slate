import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OG_SIZE, SITE_NAME, SITE_URL } from "@/lib/seo";

/** What one share card says. `lines` is the headline, one entry per row; the last row is drawn in the accent colour. */
export interface OgCard {
  lines: string[];
  sub: string;
  chips: string[];
}

const dataUri = async (file: string, mime: string) =>
  `data:${mime};base64,${(await readFile(join(process.cwd(), "public", file))).toString("base64")}`;

/** The card shown when a Slate link is pasted into Slack, X, LinkedIn, WhatsApp, Discord... Every page shares this design. */
export async function renderOgCard({ lines, sub, chips }: OgCard) {
  const [logo, product] = await Promise.all([dataUri("icons/icon-192.png", "image/png"), dataUri("slate-how-to-poster.jpg", "image/jpeg")]);
  // Geist only ships a regular weight here, so size does the work; longer rows step down to stay inside the column.
  const longest = Math.max(...lines.map((l) => l.length));
  const fontSize = longest <= 12 ? 76 : longest <= 15 ? 66 : 58;

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
          <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
            {lines.map((line, i) => (
              <div
                key={line}
                style={{ display: "flex", fontSize, lineHeight: 1.06, letterSpacing: -2, color: i === lines.length - 1 ? "#A78BFA" : "white" }}
              >
                {line}
              </div>
            ))}
            <div style={{ display: "flex", marginTop: 22, fontSize: 26, lineHeight: 1.35, color: "#A0A0A0" }}>{sub}</div>
          </div>

          <div
            style={{
              display: "flex",
              width: 500,
              height: 281,
              borderRadius: 20,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.16)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={product} width={500} height={281} alt="" style={{ objectFit: "cover" }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex" }}>
            {chips.map((chip) => (
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
    { ...OG_SIZE },
  );
}
