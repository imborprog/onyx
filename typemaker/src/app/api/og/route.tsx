import { ImageResponse } from "next/og";
import { BRAND, PLAN_LIMITS } from "@/lib/config";
import { getPublicTest } from "@/lib/repo";

export const runtime = "nodejs";

const fontCache = new Map<string, ArrayBuffer>();

// Fetches only the glyphs we need from Google Fonts so Korean renders in the image.
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  const key = text;
  const hit = fontCache.get(key);
  if (hit) return hit;
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Do+Hyeon&text=${encodeURIComponent(text)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype|woff2?)'\)/)?.[1];
    if (!url) return null;
    const buf = await (await fetch(url)).arrayBuffer();
    if (fontCache.size > 200) fontCache.clear();
    fontCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const key = url.searchParams.get("key");
  const pt = await getPublicTest(slug);
  if (!pt) return new Response("not found", { status: 404 });
  const c = pt.test.content;
  const r = key ? c.results.find((x) => x.key === key) : null;
  const bg = r?.color ?? pt.test.settings.theme.accent;
  const watermark = PLAN_LIMITS[pt.plan].watermark || pt.isHouse;
  const brandLine = pt.test.settings.brandName || "";
  const top = r ? "나의 결과는" : brandLine || "심리테스트";
  const main = r ? r.name : c.title;
  const sub = r ? r.tagline : c.subtitle || "나는 어떤 유형일까?";
  const traits = r ? r.traits.slice(0, 3).map((t) => `#${t}`).join("  ") : `${c.questions.length}문항 · 결과 ${c.results.length}가지`;
  const footer = watermark ? `${BRAND.name}에서 나도 만들기` : brandLine;
  const text = [top, main, sub, traits, footer, c.title, "0123456789·#?!"].join("");
  const font = await loadFont(text);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: bg, color: "#fff", padding: "64px 72px", fontFamily: "DoHyeon" }}>
        <div style={{ display: "flex", fontSize: 34, opacity: 0.9 }}>{top}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: main.length > 14 ? 76 : 104, lineHeight: 1.1 }}>{main}</div>
          {sub ? <div style={{ display: "flex", fontSize: 40, opacity: 0.95 }}>{sub}</div> : null}
          <div style={{ display: "flex", fontSize: 32, opacity: 0.85 }}>{traits}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, opacity: 0.85 }}>
          <span>{r ? c.title : ""}</span>
          <span>{footer}</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: font ? [{ name: "DoHyeon", data: font, style: "normal", weight: 400 }] : undefined,
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
    },
  );
}
