"use client";

import Link from "next/link";
import { useState } from "react";
import { api, getSavedWorkspace, saveWorkspace } from "@/lib/client";
import type { ProductId } from "@/lib/config";

interface TossPaymentInstance {
  requestPayment(args: {
    method: "CARD";
    amount: { currency: "KRW"; value: number };
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
    customerEmail?: string;
  }): Promise<void>;
}
declare global {
  interface Window {
    TossPayments?: (clientKey: string) => { payment(args: { customerKey: string }): TossPaymentInstance };
  }
}

function loadToss(): Promise<void> {
  if (window.TossPayments) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.tosspayments.com/v2/standard";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("결제 모듈을 불러오지 못했어요"));
    document.head.appendChild(s);
  });
}

export default function Checkout({ product, amount, paymentsEnabled, clientKey }: { product: ProductId; amount: number; paymentsEnabled: boolean; clientKey: string }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agree) {
      setError("구매 조건과 환불 규정에 동의해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const order = await api<{ orderId: string; amount: number; orderName: string; customerKey: string; workspaceSecret: string }>("/api/orders", {
        workspace: getSavedWorkspace(),
        body: { product, email },
      });
      saveWorkspace(order.workspaceSecret);
      await loadToss();
      if (!window.TossPayments) throw new Error("결제 모듈을 불러오지 못했어요");
      const payment = window.TossPayments(clientKey).payment({ customerKey: order.customerKey });
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: order.amount },
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${window.location.origin}/checkout/success`,
        failUrl: `${window.location.origin}/checkout/fail`,
        customerEmail: email,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "결제를 시작하지 못했어요");
      setBusy(false);
    }
  }

  async function requestInvoice(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/sales", { workspace: getSavedWorkspace(), body: { email, company, product, message: `${product} 구매 희망 (계좌이체/세금계산서)`, source: "checkout", consent: true } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  if (!paymentsEnabled) {
    if (sent) return <div className="card stack"><b>요청을 받았어요</b><p className="small muted">담당자가 결제 방법(계좌이체·세금계산서)을 이메일로 안내해 드려요. 보통 1영업일 안에 연락드립니다.</p></div>;
    return (
      <form className="card stack" onSubmit={requestInvoice}>
        <b>계좌이체·세금계산서로 구매하기</b>
        <p className="small muted">카드 결제는 준비 중이에요. 이메일을 남겨 주시면 결제 안내를 보내 드리고, 입금 확인 후 바로 플랜을 적용해 드려요.</p>
        <div className="field"><label htmlFor="ck-email">이메일 *</label><input id="ck-email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="ck-co">회사·가게 이름</label><input id="ck-co" className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "보내는 중…" : "결제 안내 받기"}</button>
      </form>
    );
  }

  return (
    <form className="card stack" onSubmit={pay}>
      <div className="field"><label htmlFor="ck-email">영수증 받을 이메일 *</label><input id="ck-email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>주문 내용({amount.toLocaleString("ko-KR")}원, 자동 갱신 없음)과 <Link href="/legal/terms">이용약관·환불 규정</Link>을 확인했고 결제에 동의합니다.</span>
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "결제창 여는 중…" : `${amount.toLocaleString("ko-KR")}원 카드 결제`}</button>
      <p className="tiny muted">결제는 토스페이먼츠를 통해 안전하게 처리돼요. 세금계산서가 필요하면 <Link href={`/contact?product=${product}`}>도입 문의</Link>로 남겨 주세요.</p>
    </form>
  );
}
