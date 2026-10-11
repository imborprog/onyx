"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getSavedWorkspace } from "@/lib/client";
import type { Plan } from "@/lib/config";

interface ConfirmResponse {
  ok?: boolean;
  plan?: Plan;
  planUntil?: string | null;
  error?: string;
  retryable?: boolean;
}

type State =
  | { kind: "loading"; slow: boolean }
  | { kind: "ok"; plan: Plan | null; until: string | null }
  | { kind: "err"; message: string; retryable: boolean; rejected: boolean };

const PLAN_LABEL: Record<Plan, string> = { free: "무료", pro: "프로", agency: "대행사" };
// Automatic re-checks while the server answers "still processing" (503) before showing the retry button.
const RETRY_DELAYS_MS = [1500, 3000, 6000];

function SuccessInner() {
  const sp = useSearchParams();
  const paymentKey = sp.get("paymentKey");
  const orderId = sp.get("orderId");
  const amount = sp.get("amount");
  const [state, setState] = useState<State>({ kind: "loading", slow: false });
  const [ws, setWs] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Re-running confirm is always safe: the server confirms idempotently and fulfils at most once.
  const confirm = useCallback(async () => {
    if (inFlight.current) return;
    if (!paymentKey || !orderId || !amount) {
      setState({ kind: "err", message: "결제 정보가 없어요.", retryable: false, rejected: false });
      return;
    }
    inFlight.current = true;
    setState({ kind: "loading", slow: false });
    try {
      for (let attempt = 0; ; attempt++) {
        let status = 0;
        let data: ConfirmResponse = {};
        try {
          const res = await fetch("/api/payments/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentKey, orderId, amount }),
          });
          status = res.status;
          data = (await res.json().catch(() => ({}))) as ConfirmResponse;
        } catch {
          status = 0;
        }
        if (status >= 200 && status < 300) {
          setState({ kind: "ok", plan: data.plan ?? null, until: data.planUntil ?? null });
          return;
        }
        const retryable = status === 0 || status >= 500 || data.retryable === true;
        const delay = RETRY_DELAYS_MS[attempt];
        if (retryable && delay !== undefined) {
          setState({ kind: "loading", slow: true });
          await new Promise((r) => window.setTimeout(r, delay));
          continue;
        }
        setState({
          kind: "err",
          message: data.error ?? (status === 0 ? "네트워크가 불안정해 결제를 확인하지 못했어요." : "결제를 확인하지 못했어요."),
          retryable,
          rejected: status === 402,
        });
        return;
      }
    } finally {
      inFlight.current = false;
    }
  }, [paymentKey, orderId, amount]);

  useEffect(() => {
    setWs(getSavedWorkspace());
    void confirm();
  }, [confirm]);

  const safeOrderId = orderId && /^[A-Za-z0-9_-]{6,64}$/.test(orderId) ? orderId : null;

  if (state.kind === "loading") {
    return (
      <div className="stack center">
        <div className="spinner" />
        <b>결제를 확인하는 중…</b>
        {state.slow ? <p className="small muted">확인이 조금 늦어지고 있어요. 이 화면을 닫지 말고 잠시만 기다려 주세요.</p> : null}
      </div>
    );
  }
  if (state.kind === "err") {
    return (
      <div className="stack center">
        <h1 className="display" style={{ fontSize: 28 }}>{state.retryable ? "결제 확인이 끝나지 않았어요" : "결제가 완료되지 않았어요"}</h1>
        <p className="muted">{state.message}</p>
        {state.retryable ? <p className="small muted">카드 결제가 이미 승인됐다면 다시 결제하지 마시고 아래 버튼으로 확인을 다시 해 주세요.</p> : null}
        {safeOrderId ? <p className="small muted">문의할 때 주문번호 {safeOrderId}를 알려 주세요.</p> : null}
        <div className="row" style={{ justifyContent: "center" }}>
          {state.retryable ? <button type="button" className="btn btn-primary" onClick={() => void confirm()}>다시 확인하기</button> : null}
          {state.rejected ? <Link href="/pricing" className="btn btn-ghost">다른 카드로 다시 결제하기</Link> : null}
          <Link href="/support" className="btn btn-ghost">문의하기</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="stack center">
      <h1 className="display" style={{ fontSize: 30 }}>결제가 완료됐어요 🎉</h1>
      {state.until ? (
        <p className="muted">
          {state.plan ? `${PLAN_LABEL[state.plan]} 플랜을 ` : ""}
          {new Date(state.until).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}까지 이용할 수 있어요. 영수증은 이메일로 보내 드려요.
        </p>
      ) : null}
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
