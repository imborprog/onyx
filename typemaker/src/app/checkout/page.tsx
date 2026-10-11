import type { Metadata } from "next";
import Link from "next/link";
import Checkout from "@/components/Checkout";
import { ENV, isProductId, PRODUCTS } from "@/lib/config";
import { cardCheckoutStatus } from "@/lib/payments";
import { checkoutTarget, getWorkspaceBySecret } from "@/lib/repo";

// The dashboard's upgrade link carries the workspace secret (?ws=); only the origin may leave in a Referer.
export const metadata: Metadata = { title: "결제", robots: { index: false, follow: false }, referrer: "strict-origin-when-cross-origin" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ product?: string; ws?: string }> }) {
  const { product, ws } = await searchParams;
  const id = product && isProductId(product) ? product : "pro_month";
  const p = PRODUCTS[id];
  const workspace = ws ? await getWorkspaceBySecret(ws) : null;
  const target = workspace && !workspace.is_house ? await checkoutTarget(workspace, p) : null;
  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <div className="stack-lg">
        <Link href="/pricing" className="small muted">← 요금으로</Link>
        <div className="card stack">
          <span className="muted small">주문 상품</span>
          <div className="row between"><b style={{ fontSize: 20 }}>{p.name}</b><b className="display num" style={{ fontSize: 26 }}>{p.amount.toLocaleString("ko-KR")}원</b></div>
          <p className="small muted">{p.blurb} · 자동 갱신 없음 · 부가세 포함</p>
        </div>
        <Checkout
          product={id}
          productName={p.name}
          productPlan={p.plan}
          productDays={p.days}
          amount={p.amount}
          status={cardCheckoutStatus()}
          clientKey={ENV.tossClientKey()}
          initialSecret={target && workspace ? workspace.secret : null}
          initialTarget={target}
          linkInvalid={Boolean(ws) && !target}
        />
      </div>
    </div>
  );
}
