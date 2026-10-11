import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccentLinkButton, ResultHero } from "@/components/Player";
import { appUrl, BRAND, PLAN_LIMITS } from "@/lib/config";
import { getPublicTest } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, key } = await params;
  const pt = await getPublicTest(slug);
  const r = pt?.test.content.results.find((x) => x.key === key);
  if (!pt || !r) return { title: "테스트를 찾을 수 없어요" };
  const og = `${appUrl()}/api/og?slug=${slug}&key=${key}`;
  const title = `나는 「${r.name}」 — ${pt.test.content.title}`;
  return {
    title,
    description: r.tagline || pt.test.content.subtitle,
    alternates: { canonical: `${appUrl()}/t/${slug}` },
    openGraph: { title, description: r.tagline || "너는 어떤 유형이야?", images: [{ url: og, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [og] },
  };
}

export default async function SharedResultPage({ params }: Params) {
  const { slug, key } = await params;
  const pt = await getPublicTest(slug);
  if (!pt) notFound();
  const c = pt.test.content;
  const r = c.results.find((x) => x.key === key);
  if (!r) notFound();
  const { accent, style } = pt.test.settings.theme;
  const night = style === "night";
  return (
    <div className={night ? "player theme-night" : style === "calm" ? "player theme-calm" : "player"} style={night ? { background: "#12131f" } : undefined}>
      <div className="narrow" style={{ maxWidth: 560 }}>
        <div className="player-card">
          <p className="center small muted">친구의 결과</p>
          <ResultHero result={r} />
          <h1 className="q-text center">{c.title}</h1>
          <p className="center muted">나는 어떤 유형일까? {c.questions.length}문항이면 알 수 있어요.</p>
          <AccentLinkButton href={`/t/${slug}`} accent={accent}>나도 테스트하기</AccentLinkButton>
          {PLAN_LIMITS[pt.plan].watermark || pt.isHouse ? (
            <Link className="watermark" href={`/create?ref=${slug}`}>{BRAND.name}에서 만든 테스트예요 · <b>나도 만들기 →</b></Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
