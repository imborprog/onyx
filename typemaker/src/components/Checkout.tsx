"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, getSavedWorkspace, saveWorkspace } from "@/lib/client";
import type { Plan, ProductId } from "@/lib/config";
import type { CardCheckoutStatus } from "@/lib/payments";
import type { CheckoutTarget } from "@/lib/repo";

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

const PLAN_LABEL: Record<Plan, string> = { free: "무료", pro: "프로", agency: "대행사" };

function kstDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

function aboutDays(days: number): string {
  return days >= 1 ? `약 ${Math.floor(days)}일` : "하루 미만";
}

/** The secret from a pasted 관리 링크 (…/w/<secret>) or from the bare secret itself. */
function secretFromLink(input: string): string | null {
  const v = input.trim();
  const m = /\/w\/([a-f0-9]{20,64})(?:[/?#]|$)/i.exec(v) ?? /^([a-f0-9]{20,64})$/i.exec(v);
  return m?.[1] ? m[1].toLowerCase() : null;
}

function currentPlanText(t: CheckoutTarget): string {
  return t.plan === "free" || !t.planUntil ? "무료 플랜" : `${PLAN_LABEL[t.plan]} 플랜 ${kstDate(t.planUntil)}까지`;
}

function afterText(t: CheckoutTarget, productDays: number): string {
  const until = kstDate(t.after.until);
  switch (t.after.kind) {
    case "start":
      return `결제하면 ${PLAN_LABEL[t.after.plan]} 플랜이 ${until}까지 적용돼요.`;
    case "extend":
      return `결제하면 지금 쓰는 ${PLAN_LABEL[t.after.plan]} 플랜이 ${until}까지 늘어나요.`;
    case "pro_as_agency":
      return `지금 대행사 플랜을 쓰고 있어서, 이 상품은 결제 금액만큼 대행사 이용 기간(${aboutDays(t.after.convertedDays)})으로 바꿔 더해 드려요. 결제하면 대행사 플랜이 ${until}까지 이어져요.`;
    case "upgrade":
      return `남은 프로 기간은 금액 기준으로 대행사 이용 기간 ${aboutDays(t.after.convertedDays)}로 바꾸고, 대행사 ${productDays}일을 더해 드려요. 결제하면 대행사 플랜이 ${until}까지 적용돼요.`;
  }
}

export interface CheckoutProps {
  product: ProductId;
  productName: string;
  productPlan: Exclude<Plan, "free">;
  productDays: number;
  amount: number;
  status: CardCheckoutStatus;
  clientKey: string;
  /** From the dashboard's upgrade link (?ws=), already checked on the server. */
  initialSecret: string | null;
  initialTarget: CheckoutTarget | null;
  /** ?ws= was given but matched no workspace. */
  linkInvalid: boolean;
}

export default function Checkout(props: CheckoutProps) {
  const { product, productName, productPlan, productDays, amount, status, clientKey } = props;
  const cardReady = status === "ready";
  const [secret, setSecret] = useState<string | null>(props.initialTarget ? props.initialSecret : null);
  const [target, setTarget] = useState<CheckoutTarget | null>(props.initialTarget);
  const [loadingTarget, setLoadingTarget] = useState(!props.initialTarget && !props.linkInvalid);
  const [changing, setChanging] = useState(props.linkInvalid);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(props.linkInvalid ? "결제 링크에 담긴 관리 링크를 찾을 수 없어요. 내 테스트 화면의 관리 링크를 붙여 넣어 주세요." : null);
  const [createNew, setCreateNew] = useState(false);
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [agree, setAgree] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function loadTarget(s: string): Promise<boolean> {
    try {
      const t = await api<CheckoutTarget>(`/api/workspace?product=${product}`, { workspace: s });
      setSecret(s);
      setTarget(t);
      setChanging(false);
      setCreateNew(false);
      setLinkError(null);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    // The admin secret should not stay in the address bar, history or a copied link.
    const url = new URL(window.location.href);
    if (url.searchParams.has("ws")) {
      url.searchParams.delete("ws");
      window.history.replaceState(window.history.state, "", url.toString());
    }
    if (props.initialTarget || props.linkInvalid) return;
    const saved = getSavedWorkspace();
    if (!saved) {
      setLoadingTarget(false);
      return;
    }
    void loadTarget(saved).finally(() => setLoadingTarget(false));
    // Runs once on mount: the props it reads come from the server render and never change.
  }, []);

  async function applyLink() {
    const s = secretFromLink(linkInput);
    if (!s) {
      setLinkError("관리 링크 전체(…/w/로 시작하는 주소)를 붙여 넣어 주세요.");
      return;
    }
    setLoadingTarget(true);
    const ok = await loadTarget(s);
    setLoadingTarget(false);
    if (!ok) setLinkError("이 관리 링크로 워크스페이스를 찾을 수 없어요. 링크를 다시 확인해 주세요.");
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!target && !createNew) {
      setError("플랜을 적용할 워크스페이스를 정해 주세요. 관리 링크를 붙여 넣거나, 새 워크스페이스 만들기에 체크해 주세요.");
      return;
    }
    if (!agree) {
      setError("구매 조건과 환불 규정에 동의해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const order = await api<{ orderId: string; amount: number; orderName: string; customerKey: string; workspaceSecret: string }>("/api/orders", {
        workspace: target ? secret : null,
        body: { product, email, newWorkspace: !target && createNew },
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
        failUrl: `${window.location.origin}/checkout/fail?product=${product}`,
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
    if (!consent) {
      setError("결제 안내를 위한 개인정보 수집·이용에 동의해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const message = `${productName} 구매 희망 (계좌이체/세금계산서)${target ? "" : " · 적용할 워크스페이스 없음"}`;
      await api("/api/sales", { workspace: target ? secret : null, body: { email, company, product, message, source: "checkout", consent } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  const targetCard = (
    <div className="card stack">
      <span className="muted small">플랜을 적용할 워크스페이스</span>
      {loadingTarget ? <span className="small muted">워크스페이스를 확인하는 중…</span> : null}
      {target ? (
        <>
          <b>{target.brandName || "이름 없는 워크스페이스"}</b>
          <span className="small muted">{[target.emailHint, `테스트 ${target.tests}개`, currentPlanText(target)].filter(Boolean).join(" · ")}</span>
          <p className="small">{afterText(target, productDays)}</p>
          {!changing ? (
            <div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChanging(true)}>다른 워크스페이스에 적용하기</button>
            </div>
          ) : null}
        </>
      ) : !loadingTarget ? (
        <p className="small">
          이 브라우저에는 저장된 워크스페이스가 없어요. 이미 테스트를 만들었다면 <b>관리 링크</b>(…/w/로 시작하는 주소)를 붙여 넣어 주세요. 그 워크스페이스에 플랜이 적용돼요.
        </p>
      ) : null}
      {!loadingTarget && (changing || !target) ? (
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            aria-label="관리 링크"
            placeholder="https://…/w/…"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void applyLink()}>확인</button>
        </div>
      ) : null}
      {linkError ? <p className="error small" role="alert">{linkError}</p> : null}
      {!loadingTarget && !target && cardReady ? (
        <label className="check">
          <input type="checkbox" checked={createNew} onChange={(e) => setCreateNew(e.target.checked)} />
          <span>
            아직 만든 테스트가 없어요. 새 워크스페이스를 만들어 {PLAN_LABEL[productPlan]} 플랜 {productDays}일을 적용해 주세요. (새 워크스페이스의 관리 링크는 결제 완료 화면과 영수증 이메일로 알려 드려요)
          </span>
        </label>
      ) : null}
    </div>
  );

  if (!cardReady) {
    if (sent) {
      return (
        <div className="card stack">
          <b>요청을 받았어요</b>
          <p className="small muted">담당자가 결제 방법(계좌이체·세금계산서)을 이메일로 안내해 드려요. 보통 1영업일 안에 연락드립니다.</p>
        </div>
      );
    }
    return (
      <div className="stack-lg">
        <div className="notice">
          {status === "no_business_info"
            ? "판매자 정보(상호·사업자등록번호) 등록을 마치는 중이라 지금은 카드 결제를 받을 수 없어요. 아래에 이메일을 남겨 주시면 결제 방법을 안내해 드려요."
            : "카드 결제는 준비 중이에요. 아래에 이메일을 남겨 주시면 결제 방법을 안내해 드려요."}
        </div>
        {targetCard}
        <form className="card stack" onSubmit={requestInvoice}>
          <b>계좌이체·세금계산서로 구매하기</b>
          <p className="small muted">입금이 확인되면 위 워크스페이스에 바로 플랜을 적용해 드려요. 아직 테스트를 만들지 않았다면 먼저 무료로 하나 만들어 두시면 그 워크스페이스에 적용해 드릴 수 있어요.</p>
          <div className="field"><label htmlFor="ck-email">이메일 *</label><input id="ck-email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="ck-co">회사·가게 이름</label><input id="ck-co" className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>[필수] 결제 안내를 위해 이메일·회사명을 수집하고 1년간 보관하는 데 동의합니다.</span>
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "보내는 중…" : "결제 안내 받기"}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      {targetCard}
      <form className="card stack" onSubmit={pay}>
        <div className="field"><label htmlFor="ck-email">영수증 받을 이메일 *</label><input id="ck-email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>주문 내용({amount.toLocaleString("ko-KR")}원, 자동 갱신 없음)과 <Link href="/legal/terms">이용약관·환불 규정</Link>을 확인했고 결제에 동의합니다.</span>
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={busy || loadingTarget}>{busy ? "결제창 여는 중…" : `${amount.toLocaleString("ko-KR")}원 카드 결제`}</button>
        <p className="tiny muted">결제는 토스페이먼츠를 통해 안전하게 처리돼요. 세금계산서가 필요하면 <Link href={`/contact?product=${product}`}>도입 문의</Link>로 남겨 주세요.</p>
      </form>
    </div>
  );
}
