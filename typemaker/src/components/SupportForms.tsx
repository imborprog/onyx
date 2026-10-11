"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, getSavedWorkspace } from "@/lib/client";

const CATEGORIES = [
  { v: "general", label: "사용 방법" },
  { v: "bug", label: "오류 신고" },
  { v: "billing", label: "결제·영수증" },
  { v: "refund", label: "환불" },
  { v: "privacy", label: "개인정보·데이터 삭제" },
  { v: "sales", label: "도입·제휴" },
] as const;

export function NewTicketForm() {
  const router = useRouter();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["v"]>("general");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const r = await api<{ token: string }>("/api/support", { workspace: getSavedWorkspace(), body: { category, email, name, subject, body } });
          router.push(`/support/${r.token}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "보내지 못했어요");
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="sp-cat">문의 유형</label>
        <select id="sp-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </div>
      <div className="grid-2">
        <div className="field"><label htmlFor="sp-email">이메일 (답변 알림)</label><input id="sp-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="sp-name">이름</label><input id="sp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>
      </div>
      <div className="field"><label htmlFor="sp-sub">제목 *</label><input id="sp-sub" className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} /></div>
      <div className="field"><label htmlFor="sp-body">내용 *</label><textarea id="sp-body" className="textarea" required value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="테스트 링크나 화면에 보이는 오류 문구를 함께 적어 주시면 더 빨리 도와드릴 수 있어요." /></div>
      <p className="tiny muted">입력한 이메일·이름은 문의 답변을 위해서만 쓰고 처리 완료 후 1년 뒤 삭제해요.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "보내는 중…" : "문의 보내기"}</button>
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
          setError("개인정보 수집에 동의해 주세요.");
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
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>[필수] 문의 답변을 위해 이름·회사명·이메일·연락처를 수집하고 1년간 보관하는 데 동의합니다.</span></label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "보내는 중…" : "문의 보내기"}</button>
    </form>
  );
}
