import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Player, { type PublicSettings } from "@/components/Player";
import { appUrl, BRAND, ENV, PLAN_LIMITS } from "@/lib/config";
import { getPublicTest } from "@/lib/repo";
import type { Settings, TestContent } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** Everything is serialized into the page, so coupon codes are dropped here; only which results have one is kept. */
function forBrowser(settings: Settings, content: TestContent): { settings: PublicSettings; couponAvailable: boolean; couponResultKeys: string[] } {
  const { code, perResult, ...coupon } = settings.coupon;
  const couponResultKeys = settings.coupon.enabled ? content.results.filter((r) => Boolean((Object.hasOwn(perResult, r.key) && perResult[r.key]) || code)).map((r) => r.key) : [];
  return { settings: { ...settings, coupon }, couponAvailable: couponResultKeys.length > 0, couponResultKeys };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const pt = await getPublicTest(slug);
  if (!pt) return { title: "테스트를 찾을 수 없어요" };
  const c = pt.test.content;
  const og = `${appUrl()}/api/og?slug=${slug}`;
  return {
    title: c.title,
    description: c.subtitle || c.intro || `${BRAND.name}에서 만든 심리테스트`,
    alternates: { canonical: `${appUrl()}/t/${slug}` },
    openGraph: { title: c.title, description: c.subtitle || "나는 어떤 유형일까?", images: [{ url: og, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: c.title, images: [og] },
  };
}

export default async function TestPage({ params }: Params) {
  const { slug } = await params;
  const pt = await getPublicTest(slug);
  if (!pt) notFound();
  const { test, plan, isHouse } = pt;
  const pub = forBrowser(test.settings, test.content);
  return (
    <Player
      slug={test.slug}
      content={test.content}
      settings={pub.settings}
      couponAvailable={pub.couponAvailable}
      couponResultKeys={pub.couponResultKeys}
      watermark={PLAN_LIMITS[plan].watermark || isHouse}
      isHouse={isHouse}
      preview={false}
      publicUrl={`${appUrl()}/t/${test.slug}`}
      kakaoKey={ENV.kakaoJsKey()}
      brandName={BRAND.name}
    />
  );
}
