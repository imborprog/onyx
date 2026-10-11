import { ImageResponse } from "next/og";
import { appUrl, BRAND, PLAN_LIMITS } from "@/lib/config";
import { getPublicTest } from "@/lib/repo";

export const runtime = "nodejs";

const fontCache = new Map<string, ArrayBuffer>();

// Fetches only the glyphs we need from Google Fonts so Korean renders in the image.
// Only a good response is cached: an error page cached as "font data" would break every later render of the same text.
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  const key = text;
  const hit = fontCache.get(key);
  if (hit) return hit;
  try {
    const cssRes = await fetch(`https://fonts.googleapis.com/css2?family=Do+Hyeon&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(4000) });
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    // Satori reads TTF, OTF and WOFF, not WOFF2.
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype|woff)'\)/)?.[1];
    if (!url) return null;
    const fontRes = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!fontRes.ok) return null;
    const buf = await fontRes.arrayBuffer();
    if (buf.byteLength < 1024) return null;
    if (fontCache.size > 200) fontCache.clear();
    fontCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

// Same rule as the player's result card: dark or white text, whichever contrasts more (WCAG luminance).
const DARK_INK = "#15172b";
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function readableInk(bg: string): string {
  const l = luminance(bg);
  if (l === null) return "#ffffff";
  const dark = luminance(DARK_INK) ?? 0;
  return (l + 0.05) / (dark + 0.05) > 1.05 / (l + 0.05) ? DARK_INK : "#ffffff";
}

/** Cuts to `max` characters (by code point) with an ellipsis. Line clamping below is the second guard. */
function clampText(s: string, max: number): string {
  const chars = Array.from(s.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

interface Layout {
  width: number;
  height: number;
  padding: string;
  top: number;
  mainSize: (len: number) => number;
  mainMax: number;
  mainLines: number;
  sub: number;
  subMax: number;
  subLines: number;
  traits: number;
  footer: number;
}

// og: the 1200x630 link-preview card. story: 1080x1920 for Instagram/Kakao stories.
const LAYOUTS: Record<"og" | "story", Layout> = {
  og: {
    width: 1200,
    height: 630,
    padding: "56px 72px",
    top: 34,
    mainSize: (len) => (len <= 10 ? 104 : len <= 16 ? 84 : 68),
    mainMax: 30,
    mainLines: 2,
    sub: 36,
    subMax: 56,
    subLines: 2,
    traits: 30,
    footer: 26,
  },
  story: {
    width: 1080,
    height: 1920,
    padding: "140px 96px 120px",
    top: 48,
    mainSize: (len) => (len <= 6 ? 150 : len <= 12 ? 120 : 96),
    mainMax: 27,
    mainLines: 3,
    sub: 52,
    subMax: 80,
    subLines: 3,
    traits: 44,
    footer: 36,
  },
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const key = url.searchParams.get("key");
  const format = url.searchParams.get("format") === "story" ? "story" : "og";
  const L = LAYOUTS[format];
  const pt = await getPublicTest(slug);
  if (!pt) return new Response("not found", { status: 404 });
  const c = pt.test.content;
  const r = key ? c.results.find((x) => x.key === key) : null;
  const bg = r?.color ?? pt.test.settings.theme.accent;
  const ink = readableInk(bg);
  const watermark = PLAN_LIMITS[pt.plan].watermark || pt.isHouse;
  const brandLine = clampText(pt.test.settings.brandName || "", 24);
  const top = r ? "나의 결과는" : brandLine || "심리테스트";
  const main = clampText(r ? r.name : c.title, L.mainMax);
  const sub = clampText(r ? r.tagline : c.subtitle || "나는 어떤 유형일까?", L.subMax);
  const traits = clampText(r ? r.traits.slice(0, 3).map((t) => `#${clampText(t, 12)}`).join("  ") : `${c.questions.length}문항 · 결과 ${c.results.length}가지`, 44);
  const footer = watermark ? `${BRAND.name}에서 나도 만들기` : brandLine;
  const footerLeft = r ? clampText(c.title, format === "story" ? 30 : 28) : "";
  const storyLink = format === "story" ? `${new URL(appUrl()).host}/t/${pt.test.slug}` : "";
  const text = [top, main, sub, traits, footer, footerLeft, storyLink, "0123456789·#?!…나도 해 보기"].join("");
  const font = await loadFont(text);
  const mainSize = L.mainSize(Array.from(main).length);
  const lineClamp = (lines: number) => ({ display: "block" as const, lineClamp: lines, overflow: "hidden" as const });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: bg, color: ink, padding: L.padding, fontFamily: "DoHyeon" }}>
        <div style={{ display: "flex", fontSize: L.top, opacity: 0.9 }}>{top}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: format === "story" ? 32 : 16, overflow: "hidden" }}>
          <div style={{ ...lineClamp(L.mainLines), fontSize: mainSize, lineHeight: 1.12 }}>{main}</div>
          {sub ? <div style={{ ...lineClamp(L.subLines), fontSize: L.sub, lineHeight: 1.3, opacity: 0.95 }}>{sub}</div> : null}
          <div style={{ ...lineClamp(format === "story" ? 2 : 1), fontSize: L.traits, lineHeight: 1.3, opacity: 0.85 }}>{traits}</div>
        </div>
        {format === "story" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: L.footer, opacity: 0.9 }}>
            {footerLeft ? <div style={{ ...lineClamp(1) }}>{footerLeft}</div> : null}
            <div style={{ display: "flex", fontSize: L.footer + 4 }}>나도 해 보기 · {storyLink}</div>
            {footer ? <div style={{ display: "flex", opacity: 0.8 }}>{footer}</div> : null}
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 24, fontSize: L.footer, opacity: 0.85 }}>
            <span style={{ ...lineClamp(1), maxWidth: 640 }}>{footerLeft}</span>
            <span style={{ display: "flex", flexShrink: 0 }}>{footer}</span>
          </div>
        )}
      </div>
    ),
    {
      width: L.width,
      height: L.height,
      fonts: font ? [{ name: "DoHyeon", data: font, style: "normal", weight: 400 }] : undefined,
      // Without the Korean font the image is missing glyphs, so it must not stick in the CDN for an hour.
      headers: { "Cache-Control": font ? "public, max-age=300, s-maxage=3600" : "public, max-age=60, s-maxage=60" },
    },
  );
}
