import type { Metadata } from "next";
import Link from "next/link";
import Checkout from "@/components/Checkout";
import { ENV, isProductId, paymentsEnabled, PRODUCTS } from "@/lib/config";

export const metadata: Metadata = { title: "결제", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const id = product && isProductId(product) ? product : "pro_month";
  const p = PRODUCTS[id];
  return (
    <div className="narrow" style={{ paddingBlock: 40 }}>
      <div className="stack-lg">
        <Link href="/pricing" className="small muted">← 요금으로</Link>
        <div className="card stack">
          <span className="muted small">주문 상품</span>
          <div className="row between"><b style={{ fontSize: 20 }}>{p.name}</b><b className="display num" style={{ fontSize: 26 }}>{p.amount.toLocaleString("ko-KR")}원</b></div>
          <p className="small muted">{p.blurb} · 자동 갱신 없음 · 부가세 포함</p>
        </div>
        <Checkout product={id} amount={p.amount} paymentsEnabled={paymentsEnabled()} clientKey={ENV.tossClientKey()} />
      </div>
    </div>
  );
}
