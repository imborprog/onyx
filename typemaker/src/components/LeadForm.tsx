"use client";

import { useState } from "react";
import { api, sessionId } from "@/lib/client";
import type { PublicSettings } from "./Player";

interface Props {
  slug: string;
  settings: PublicSettings;
  resultKey: string;
  preview: boolean;
  /** Text color that stays readable on the accent-colored submit button. */
  accentInk?: string;
  /** coupon: the code released for this result, or null when there is none (always null in preview). */
  onDone: (coupon: string | null) => void;
}

export default function LeadForm({ slug, settings, resultKey, preview, accentInk, onDone }: Props) {
  const f = settings.lead.fields;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [age, setAge] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [night, setNight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const collector = settings.brandName || "테스트 운영자";
  const items = f.map((x) => (x === "name" ? "이름" : x === "phone" ? "연락처" : "이메일")).join(", ");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!privacy || !age) {
      setError("필수 항목에 동의해 주세요.");
      return;
    }
    if (preview) {
      onDone(null);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ ok: true; coupon: string | null }>("/api/leads", {
        body: {
          slug,
          resultKey,
          name: name || null,
          phone: phone || null,
          email: email || null,
          consentPrivacy: privacy,
          ageOver14: age,
          consentMarketing: marketing,
          consentNight: marketing && night,
          sessionId: sessionId(),
        },
      });
      onDone(typeof res.coupon === "string" && res.coupon ? res.coupon : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "제출하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {f.includes("name") ? <input className="input" aria-label="이름" placeholder="이름" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /> : null}
      {f.includes("phone") ? <input className="input" aria-label="연락처" placeholder="연락처 (010-0000-0000)" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} required /> : null}
      {f.includes("email") ? <input className="input" aria-label="이메일" type="email" placeholder="이메일" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} required /> : null}
      <label className="check">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        <span>[필수] 개인정보 수집·이용 동의 — 수집자: {collector} / 항목: {items} / 목적: {settings.lead.purpose} / 보유기간: {settings.lead.retentionDays}일 후 파기. 동의를 거부할 수 있어요. 거부해도 테스트 결과는 볼 수 있지만, 연락처가 필요한 참여 혜택(쿠폰·안내 등)은 받을 수 없어요.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
        <span>[필수] 만 14세 이상입니다.</span>
      </label>
      {settings.lead.askMarketing ? (
        <>
          <label className="check">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>[선택] {collector}의 할인·이벤트 등 광고성 정보를 문자·이메일로 받겠습니다.</span>
          </label>
          {marketing ? (
            <label className="check">
              <input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} />
              <span>[선택] 야간(21시~다음 날 8시)에도 받겠습니다.</span>
            </label>
          ) : null}
        </>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary btn-block" style={{ background: settings.theme.accent, color: accentInk }} disabled={busy}>{busy ? "제출 중…" : "제출하기"}</button>
    </form>
  );
}
