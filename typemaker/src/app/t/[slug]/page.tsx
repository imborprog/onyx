import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Player from "@/components/Player";
import { appUrl, BRAND, ENV, PLAN_LIMITS } from "@/lib/config";
import { getPublicTest } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string; r?: string }> };

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { preview } = await searchParams;
  const pt = await getPublicTest(slug, preview);
  if (!pt) return { title: "테스트를 찾을 수 없어요" };
  const c = pt.test.content;
  const og = `${appUrl()}/api/og?slug=${slug}`;
  return {
    title: c.title,
    description: c.subtitle || c.intro || `${BRAND.name}에서 만든 심리테스트`,
    alternates: { canonical: `${appUrl()}/t/${slug}` },
    robots: pt.test.status === "published" ? undefined : { index: false },
    openGraph: { title: c.title, description: c.subtitle || "나는 어떤 유형일까?", images: [{ url: og, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: c.title, images: [og] },
  };
}

export default async function TestPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const pt = await getPublicTest(slug, preview);
  if (!pt) notFound();
  const { test, plan, isHouse } = pt;
  return (
    <Player
      slug={test.slug}
      content={test.content}
      settings={test.settings}
      watermark={PLAN_LIMITS[plan].watermark || isHouse}
      isHouse={isHouse}
      preview={test.status !== "published"}
      publicUrl={`${appUrl()}/t/${test.slug}`}
      kakaoKey={ENV.kakaoJsKey()}
      brandName={BRAND.name}
    />
  );
}
