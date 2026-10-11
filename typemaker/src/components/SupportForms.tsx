"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, getSavedWorkspace } from "@/lib/client";

const CATEGORIES = [
  { v: "general", label: "사용 방법" },
  { v: "bug", label: "오류 신고" },
  { v: "billing", label: "결제·영수증" },
  { v: "refund", label: "환불" },
  { v: "privacy", label: "개인정보·데이터 삭제" },
  { v: "unsubscribe", label: "광고 수신거부" },
  { v: "sales", label: "도입·제휴" },
] as const;

type Category = (typeof CATEGORIES)[number]["v"];
/** What /api/support and the tickets table accept. 수신거부 goes in as a privacy ticket with a "[수신거부]" subject. */
type TicketCategory = Exclude<Category, "unsubscribe">;

type OptOutTarget = "service" | "brand";

const OPT_OUT_TARGETS: { v: OptOutTarget; label: string }[] = [
  { v: "service", label: "이 서비스가 보낸 소식·광고 메일" },
  { v: "brand", label: "브랜드 테스트에 연락처를 남긴 뒤 받은 광고" },
];

/**
 * A 수신거부 ticket laid out for the operator (ops/PLAYBOOK.md "수신거부"): "service" is step ①
 * (ops.unsubscribe by email), "brand" is step ② (ops.withdraw_lead_marketing by email or phone).
 */
function optOutTicket(target: OptOutTarget, contact: string, brand: string, note: string): { subject: string; body: string } {
  const lines = [
    "광고성 정보 수신거부 요청",
    `대상: ${target === "service" ? "서비스 소식·광고 메일 (워크스페이스 이메일)" : "브랜드 테스트 참여 후 받은 광고 (리드 연락처)"}`,
    `연락처: ${contact.trim()}`,
  ];
  if (target === "brand" && brand.trim()) lines.push(`브랜드·테스트: ${brand.trim()}`);
  // Kept well under the API's 4000-character body limit, even with text carried over from another category.
  if (note.trim()) lines.push("", note.trim().slice(0, 3000));
  return {
    subject: target === "service" ? "[수신거부] 서비스 소식·광고 메일" : "[수신거부] 브랜드 테스트 참여 후 받은 광고",
    body: lines.join("\n"),
  };
}

export function NewTicketForm() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>("general");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [optOutTarget, setOptOutTarget] = useState<OptOutTarget>("service");
  const [optOutContact, setOptOutContact] = useState("");
  const [optOutBrand, setOptOutBrand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optOut = category === "unsubscribe";

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        const ticket: { category: TicketCategory; subject: string; body: string } =
          category === "unsubscribe"
            ? { category: "privacy", ...optOutTicket(optOutTarget, optOutContact, optOutBrand, body) }
            : { category, subject, body };
        try {
          const r = await api<{ token: string }>("/api/support", { workspace: getSavedWorkspace(), body: { ...ticket, email, name } });
          router.push(`/support/${r.token}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "보내지 못했어요");
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="sp-cat">문의 유형</label>
        <select id="sp-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </div>
      <div className="grid-2">
        <div className="field"><label htmlFor="sp-email">이메일 (선택, 답변 알림용)</label><input id="sp-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="sp-name">이름 (선택)</label><input id="sp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>
      </div>
      {optOut ? (
        <>
          <div className="field">
            <span className="label">어떤 광고를 그만 받고 싶으세요?</span>
            <div className="segmented" role="group" aria-label="수신거부 대상">
              {OPT_OUT_TARGETS.map((t) => (
                <button key={t.v} type="button" aria-pressed={optOutTarget === t.v} onClick={() => setOptOutTarget(t.v)}>{t.label}</button>
              ))}
            </div>
          </div>
          {optOutTarget === "service" ? (
            <div className="field">
              <label htmlFor="sp-oo-contact">광고 메일을 받은 이메일 주소 *</label>
              <input id="sp-oo-contact" type="email" className="input" required value={optOutContact} onChange={(e) => setOptOutContact(e.target.value)} maxLength={120} />
            </div>
          ) : (
            <div className="grid-2">
              <div className="field">
                <label htmlFor="sp-oo-contact">테스트에 남긴 이메일 또는 전화번호 *</label>
                <input id="sp-oo-contact" className="input" required value={optOutContact} onChange={(e) => setOptOutContact(e.target.value)} maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="sp-oo-brand">브랜드나 테스트 이름 (선택)</label>
                <input id="sp-oo-brand" className="input" value={optOutBrand} onChange={(e) => setOptOutBrand(e.target.value)} maxLength={80} />
              </div>
            </div>
          )}
          <div className="field"><label htmlFor="sp-body">추가로 전할 내용 (선택)</label><textarea id="sp-body" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} /></div>
          <p className="small muted">
            처리하면 이 연락처를 수신거부 목록에 올려 앞으로 광고성 정보를 보내지 않고, 발송을 기다리던 광고도 취소해요.
            {optOutTarget === "brand" ? " 해당 브랜드(테스트 제작자)에게도 철회 사실을 알려 드려요." : " 테스트를 만든 분이라면 대시보드에서 소식 메일 수신을 직접 꺼도 돼요."}
            {" "}처리한 날짜는 이 문의 페이지로(이메일을 적으면 메일로도) 알려 드려요. 결제 안내·문의 답변 같은 서비스 안내는 계속 받으실 수 있어요. 수신거부 목록에는 다시 받겠다고 요청하실 때까지 연락처만 보관해요.
          </p>
        </>
      ) : (
        <>
          <div className="field"><label htmlFor="sp-sub">제목 *</label><input id="sp-sub" className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} /></div>
          <div className="field"><label htmlFor="sp-body">내용 *</label><textarea id="sp-body" className="textarea" required value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="테스트 링크나 화면에 보이는 오류 문구를 함께 적어 주시면 더 빨리 도와드릴 수 있어요." /></div>
        </>
      )}
      <p className="tiny muted">
        이메일·이름과 문의 내용은 답변과 처리 기록에만 써요. 답변이 끝난 문의는 마지막 메시지로부터 1년 뒤 자동으로 지워요.
        문의는 AI(Anthropic의 Claude, 미국)가 먼저 읽고 답변하며, 환불·결제 취소·개인정보 삭제는 사람이 확인해요.
        도배 방지를 위해 접속 IP는 원래 주소를 알 수 없는 해시값으로만 저장하고 90일 뒤 지워요. 자세한 내용은 <Link href="/legal/privacy">개인정보처리방침</Link>을 확인해 주세요.
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "보내는 중…" : optOut ? "수신거부 요청하기" : "문의 보내기"}</button>
    </form>
  );
}

export function ReplyForm({ token }: { token: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/api/support/${token}`, { body: { body } });
          setBody("");
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "보내지 못했어요");
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea aria-label="추가 메시지" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="추가로 전할 내용을 적어 주세요" maxLength={4000} required />
      {error ? <p className="error">{error}</p> : null}
      <div><button type="submit" className="btn btn-dark btn-sm" disabled={busy}>{busy ? "보내는 중…" : "보내기"}</button></div>
    </form>
  );
}

export function ContactForm({ defaultProduct }: { defaultProduct: string }) {
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", product: defaultProduct, message: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (done) return <div className="card stack"><b>문의를 받았어요</b><p className="small muted">담당자가 1영업일 안에 이메일로 연락드릴게요.</p></div>;
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!consent) {
          setError("개인정보 수집·이용에 동의해 주세요.");
          return;
        }
        setBusy(true);
        try {
          await api("/api/sales", { workspace: getSavedWorkspace(), body: { ...form, source: "contact", consent: true } });
          setDone(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "보내지 못했어요");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid-2">
        <div className="field"><label htmlFor="ct-name">이름</label><input id="ct-name" className="input" value={form.name} onChange={set("name")} maxLength={40} /></div>
        <div className="field"><label htmlFor="ct-co">회사·가게 이름</label><input id="ct-co" className="input" value={form.company} onChange={set("company")} maxLength={80} /></div>
        <div className="field"><label htmlFor="ct-email">이메일 *</label><input id="ct-email" type="email" required className="input" value={form.email} onChange={set("email")} /></div>
        <div className="field"><label htmlFor="ct-phone">연락처</label><input id="ct-phone" className="input" value={form.phone} onChange={set("phone")} maxLength={20} /></div>
      </div>
      <div className="field">
        <label htmlFor="ct-prod">관심 상품</label>
        <select id="ct-prod" className="select" value={form.product} onChange={set("product")}>
          <option value="pro_month">프로 30일</option><option value="pro_year">프로 1년</option><option value="agency_month">대행사</option><option value="campaign">캠페인 패스 (기획 대행)</option><option value="other">기타·제휴</option>
        </select>
      </div>
      <div className="field"><label htmlFor="ct-msg">문의 내용</label><textarea id="ct-msg" className="textarea" value={form.message} onChange={set("message")} maxLength={2000} placeholder="업종, 원하는 테스트 주제, 세금계산서 필요 여부 등을 적어 주세요." /></div>
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>[필수] 문의 답변과 상담을 위해 이름·회사명·이메일·연락처·문의 내용을 수집·이용하고, 마지막 처리 후 1년이 지나면 삭제하는 데 동의합니다. 동의하지 않을 수 있지만, 그러면 문의를 접수할 수 없어요.</span></label>
      <p className="tiny muted">
        문의 내용은 AI(Anthropic의 Claude, 미국)가 읽고 회신하며, 입금 확인과 환불은 사람이 직접 해요. 도배 방지를 위해 접속 IP는 원래 주소를 알 수 없는 해시값으로만 저장하고 90일 뒤 지워요.
        광고 메일을 그만 받으려면 이 양식 대신 <Link href="/support">고객지원</Link>에서 &lsquo;광고 수신거부&rsquo;를 골라 요청해 주세요. 자세한 내용은 <Link href="/legal/privacy">개인정보처리방침</Link>을 확인해 주세요.
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "보내는 중…" : "문의 보내기"}</button>
    </form>
  );
}
