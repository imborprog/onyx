"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, getSavedWorkspace } from "@/lib/client";

function SuccessInner() {
  const sp = useSearchParams();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ok"; until: string | null } | { kind: "err"; message: string }>({ kind: "loading" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const paymentKey = sp.get("paymentKey");
    const orderId = sp.get("orderId");
    const amount = sp.get("amount");
    if (!paymentKey || !orderId || !amount) {
      setState({ kind: "err", message: "결제 정보가 없어요." });
      return;
    }
    api<{ ok: boolean; planUntil?: string | null }>("/api/payments/confirm", { body: { paymentKey, orderId, amount } })
      .then((r) => setState({ kind: "ok", until: r.planUntil ?? null }))
      .catch((e: unknown) => setState({ kind: "err", message: e instanceof Error ? e.message : "결제 승인에 실패했어요" }));
  }, [sp]);

  const ws = typeof window !== "undefined" ? getSavedWorkspace() : null;
  if (state.kind === "loading") return <div className="stack center"><div className="spinner" /><b>결제를 확인하는 중…</b></div>;
  if (state.kind === "err") {
    return (
      <div className="stack center">
        <h1 className="display" style={{ fontSize: 28 }}>결제가 완료되지 않았어요</h1>
        <p className="muted">{state.message}</p>
        <div className="row" style={{ justifyContent: "center" }}><Link href="/pricing" className="btn btn-ghost">다시 시도</Link><Link href="/support" className="btn btn-ghost">문의하기</Link></div>
      </div>
    );
  }
  return (
    <div className="stack center">
      <h1 className="display" style={{ fontSize: 30 }}>결제가 완료됐어요 🎉</h1>
      {state.until ? <p className="muted">{new Date(state.until).toLocaleDateString("ko-KR")}까지 이용할 수 있어요. 영수증은 이메일로 보내 드려요.</p> : null}
      <div><Link href={ws ? `/w/${ws}?paid=1` : "/my"} className="btn btn-primary">내 테스트로 가기</Link></div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <div className="narrow" style={{ paddingBlock: 64 }}>
      <Suspense fallback={<div className="spinner" />}><SuccessInner /></Suspense>
    </div>
  );
}
