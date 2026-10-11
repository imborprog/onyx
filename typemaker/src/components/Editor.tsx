"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { Plan } from "@/lib/config";
import { SettingsSchema, TestContentSchema, type Settings, type TestContent } from "@/lib/schema";
import { resultReach } from "@/lib/scoring";
import type { TestStats } from "@/lib/repo";
import { CopyButton } from "./WorkspaceBits";

type Status = "draft" | "published" | "archived";
type Tab = "content" | "settings" | "stats" | "leads" | "share";

export interface LeadView {
  id: string;
  result_key: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  consent_marketing: boolean;
  created_at: string;
}

interface Props {
  secret: string;
  testId: string;
  slug: string;
  initialStatus: Status;
  initialContent: TestContent;
  initialSettings: Settings;
  plan: Plan;
  watermark: boolean;
  stats: TestStats;
  leads: LeadView[];
  leadsHidden: number;
  leadsTotal: number;
  publicUrl: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "content", label: "질문·결과" },
  { id: "settings", label: "리드·쿠폰·디자인" },
  { id: "stats", label: "성과" },
  { id: "leads", label: "리드" },
  { id: "share", label: "공유" },
];

function nextKey(results: TestContent["results"]): string {
  let i = results.length + 1;
  while (results.some((r) => r.key === `r${i}`)) i++;
  return `r${i}`;
}

export default function Editor(p: Props) {
  const [tab, setTab] = useState<Tab>("content");
  const [content, setContent] = useState<TestContent>(p.initialContent);
  const [settings, setSettings] = useState<Settings>(p.initialSettings);
  const [status, setStatus] = useState<Status>(p.initialStatus);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reach = useMemo(() => resultReach(content), [content]);
  const maxReach = Math.max(1, ...Object.values(reach));

  function editContent(fn: (c: TestContent) => TestContent) {
    setContent((c) => fn(structuredClone(c)));
    setDirty(true);
  }
  function editSettings(fn: (s: Settings) => Settings) {
    setSettings((s) => fn(structuredClone(s)));
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    const c = TestContentSchema.safeParse(content);
    if (!c.success) {
      setMsg({ kind: "err", text: c.error.issues[0]?.message ?? "내용을 확인해 주세요" });
      setTab("content");
      return false;
    }
    const s = SettingsSchema.safeParse(settings);
    if (!s.success) {
      setMsg({ kind: "err", text: s.error.issues[0]?.message ?? "설정을 확인해 주세요" });
      setTab("settings");
      return false;
    }
    setSaving(true);
    try {
      await api(`/api/tests/${p.testId}`, { method: "PATCH", workspace: p.secret, body: { content: c.data, settings: s.data } });
      setDirty(false);
      setMsg({ kind: "ok", text: "저장했어요" });
      return true;
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "저장하지 못했어요" });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(next: Status) {
    if (dirty && !(await save())) return;
    try {
      await api(`/api/tests/${p.testId}/publish`, { workspace: p.secret, body: { status: next } });
      setStatus(next);
      setMsg({ kind: "ok", text: next === "published" ? "발행했어요! 공유 탭에서 링크를 복사하세요." : "발행을 멈췄어요" });
      if (next === "published") setTab("share");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "상태를 바꾸지 못했어요" });
    }
  }

  const resultName = (key: string | null) => content.results.find((r) => r.key === key)?.name ?? key ?? "-";

  return (
    <div className="stack-lg">
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="display" style={{ fontSize: 28 }}>{content.title}</h1>
          <div className="row small">
            <span className={status === "published" ? "pill green" : "pill gray"}>{status === "published" ? "발행됨" : "초안"}</span>
            {dirty ? <span className="muted">저장하지 않은 변경사항</span> : null}
          </div>
        </div>
        <div className="row">
          <a className="btn btn-ghost btn-sm" href={`/t/${p.slug}?preview=${p.secret}`} target="_blank" rel="noreferrer">미리보기</a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={save} disabled={saving || !dirty}>{saving ? "저장 중…" : "저장"}</button>
          {status === "published" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeStatus("draft")}>발행 중지</button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => changeStatus("published")}>발행하기</button>
          )}
        </div>
      </div>
      {msg ? <p className={msg.kind === "err" ? "error" : "small"} role="status">{msg.text}</p> : null}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === "content" ? (
        <div className="stack-lg">
          <div className="card stack">
            <div className="field"><label htmlFor="t-title">제목</label><input id="t-title" className="input" maxLength={60} value={content.title} onChange={(e) => editContent((c) => ({ ...c, title: e.target.value }))} /></div>
            <div className="field"><label htmlFor="t-sub">부제</label><input id="t-sub" className="input" maxLength={120} value={content.subtitle} onChange={(e) => editContent((c) => ({ ...c, subtitle: e.target.value }))} /></div>
            <div className="field"><label htmlFor="t-intro">시작 화면 안내</label><textarea id="t-intro" className="textarea" maxLength={400} value={content.intro} onChange={(e) => editContent((c) => ({ ...c, intro: e.target.value }))} /></div>
          </div>

          <div className="card stack">
            <b>결과별 도달 점수</b>
            <p className="small muted">보기에서 받을 수 있는 점수의 합이에요. 비슷할수록 결과가 고르게 나와요.</p>
            {content.results.map((r) => (
              <div key={r.key} className="bar-row">
                <span>{r.emoji} {r.name}</span>
                <span className="bar"><i style={{ width: `${((reach[r.key] ?? 0) / maxReach) * 100}%`, background: r.color }} /></span>
                <span className="num small">{reach[r.key] ?? 0}</span>
              </div>
            ))}
          </div>

          <div className="stack">
            <div className="row between">
              <h2 style={{ fontSize: 20 }}>결과 유형 ({content.results.length})</h2>
              <button type="button" className="btn btn-ghost btn-sm" disabled={content.results.length >= 12}
                onClick={() => editContent((c) => ({ ...c, results: [...c.results, { key: nextKey(c.results), name: "새 유형", emoji: "✨", tagline: "", description: "", traits: [], bestMatch: null, color: "#2f6fed" }] }))}>
                결과 추가
              </button>
            </div>
            {content.results.map((r, ri) => (
              <div key={r.key} className="q-edit">
                <div className="row">
                  <input aria-label="이모지" className="input" style={{ width: 64 }} maxLength={8} value={r.emoji} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).emoji = e.target.value; return c; })} />
                  <input aria-label="결과 이름" className="input" style={{ flex: 1, minWidth: 160 }} maxLength={40} value={r.name} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).name = e.target.value; return c; })} />
                  <input aria-label="색" type="color" value={r.color} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).color = e.target.value; return c; })} style={{ width: 44, height: 40, border: 0, background: "none" }} />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={content.results.length <= 2}
                    onClick={() => editContent((c) => {
                      c.results.splice(ri, 1);
                      for (const q of c.questions) for (const o of q.options) {
                        o.weights = o.weights.filter((w) => w.key !== r.key);
                        if (o.weights.length === 0) o.weights = [{ key: (c.results[0] as typeof r).key, points: 1 }];
                      }
                      for (const x of c.results) if (x.bestMatch === r.key) x.bestMatch = null;
                      return c;
                    })}>삭제</button>
                </div>
                <input aria-label="한 줄 요약" className="input" maxLength={100} placeholder="한 줄 요약" value={r.tagline} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).tagline = e.target.value; return c; })} />
                <textarea aria-label="설명" className="textarea" maxLength={900} placeholder="결과 설명" value={r.description} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).description = e.target.value; return c; })} />
                <div className="grid-2">
                  <input aria-label="특징 키워드" className="input" placeholder="특징 키워드 (쉼표로 구분)" value={r.traits.join(", ")}
                    onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).traits = e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 6); return c; })} />
                  <select aria-label="잘 맞는 유형" className="select" value={r.bestMatch ?? ""} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).bestMatch = e.target.value || null; return c; })}>
                    <option value="">잘 맞는 유형 없음</option>
                    {content.results.filter((x) => x.key !== r.key).map((x) => <option key={x.key} value={x.key}>잘 맞는 유형: {x.name}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="stack">
            <div className="row between">
              <h2 style={{ fontSize: 20 }}>질문 ({content.questions.length})</h2>
              <button type="button" className="btn btn-ghost btn-sm" disabled={content.questions.length >= 15}
                onClick={() => editContent((c) => {
                  const k0 = (c.results[0] as TestContent["results"][number]).key;
                  const k1 = (c.results[1] as TestContent["results"][number]).key;
                  let n = c.questions.length + 1;
                  while (c.questions.some((q) => q.id === `q${n}`)) n++;
                  c.questions.push({ id: `q${n}`, text: "새 질문", options: [{ id: "a", text: "보기 1", weights: [{ key: k0, points: 1 }] }, { id: "b", text: "보기 2", weights: [{ key: k1, points: 1 }] }] });
                  return c;
                })}>질문 추가</button>
            </div>
            {content.questions.map((q, qi) => (
              <div key={q.id} className="q-edit">
                <div className="row">
                  <b className="num">Q{qi + 1}</b>
                  <input aria-label={`질문 ${qi + 1}`} className="input" style={{ flex: 1, minWidth: 200 }} maxLength={140} value={q.text} onChange={(e) => editContent((c) => { (c.questions[qi] as typeof q).text = e.target.value; return c; })} />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={content.questions.length <= 3} onClick={() => editContent((c) => { c.questions.splice(qi, 1); return c; })}>삭제</button>
                </div>
                {q.options.map((o, oi) => {
                  const w = o.weights[0];
                  return (
                    <div key={o.id} className="opt-edit">
                      <input aria-label={`보기 ${oi + 1}`} className="input" maxLength={100} value={o.text} onChange={(e) => editContent((c) => { ((c.questions[qi] as typeof q).options[oi] as typeof o).text = e.target.value; return c; })} />
                      <select aria-label="점수를 줄 결과" className="select" value={w?.key ?? ""} onChange={(e) => editContent((c) => { const opt = (c.questions[qi] as typeof q).options[oi] as typeof o; opt.weights[0] = { key: e.target.value, points: opt.weights[0]?.points ?? 1 }; return c; })}>
                        {content.results.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                      </select>
                      <select aria-label="점수" className="select" value={w?.points ?? 1} onChange={(e) => editContent((c) => { const opt = (c.questions[qi] as typeof q).options[oi] as typeof o; opt.weights[0] = { key: opt.weights[0]?.key ?? (c.results[0] as TestContent["results"][number]).key, points: Number(e.target.value) }; return c; })}>
                        {[1, 2, 3].map((n) => <option key={n} value={n}>+{n}</option>)}
                      </select>
                      {o.weights.length > 1 ? <span className="tiny muted" style={{ gridColumn: "1 / -1" }}>보조 점수: {o.weights.slice(1).map((x) => `${resultName(x.key)} +${x.points}`).join(", ")}</span> : null}
                    </div>
                  );
                })}
                <div className="row">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={q.options.length >= 4}
                    onClick={() => editContent((c) => { const qq = c.questions[qi] as typeof q; qq.options.push({ id: "abcd"[qq.options.length] ?? "d", text: "새 보기", weights: [{ key: (c.results[0] as TestContent["results"][number]).key, points: 1 }] }); return c; })}>보기 추가</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={q.options.length <= 2}
                    onClick={() => editContent((c) => { const qq = c.questions[qi] as typeof q; qq.options.pop(); return c; })}>마지막 보기 삭제</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="stack-lg">
          <div className="card stack">
            <b>디자인</b>
            <div className="grid-2">
              <div className="field"><label htmlFor="s-brand">브랜드 이름 (결과 화면에 표시)</label><input id="s-brand" className="input" maxLength={40} value={settings.brandName} onChange={(e) => editSettings((s) => ({ ...s, brandName: e.target.value }))} /></div>
              <div className="field">
                <label htmlFor="s-style">분위기</label>
                <select id="s-style" className="select" value={settings.theme.style} onChange={(e) => editSettings((s) => ({ ...s, theme: { ...s.theme, style: e.target.value as Settings["theme"]["style"] } }))}>
                  <option value="pop">팝 (밝고 경쾌)</option><option value="calm">차분</option><option value="night">밤 (어두운 배경)</option>
                </select>
              </div>
              <div className="field"><label htmlFor="s-accent">강조 색</label><input id="s-accent" type="color" value={settings.theme.accent} onChange={(e) => editSettings((s) => ({ ...s, theme: { ...s.theme, accent: e.target.value } }))} style={{ width: 60, height: 40, border: 0, background: "none" }} /></div>
            </div>
          </div>

          <div className="card stack">
            <label className="check"><input type="checkbox" checked={settings.lead.enabled} onChange={(e) => editSettings((s) => ({ ...s, lead: { ...s.lead, enabled: e.target.checked } }))} /><span><b>리드(연락처) 수집</b> — 결과 화면에 입력 폼을 붙여요</span></label>
            {settings.lead.enabled ? (
              <div className="stack">
                <div className="field"><label htmlFor="l-head">폼 제목</label><input id="l-head" className="input" maxLength={60} value={settings.lead.headline} onChange={(e) => editSettings((s) => ({ ...s, lead: { ...s.lead, headline: e.target.value } }))} /></div>
                <div className="row">
                  {(["name", "phone", "email"] as const).map((f) => (
                    <label key={f} className="check"><input type="checkbox" checked={settings.lead.fields.includes(f)}
                      onChange={(e) => editSettings((s) => { const set = new Set(s.lead.fields); if (e.target.checked) set.add(f); else set.delete(f); const fields = [...set]; return { ...s, lead: { ...s.lead, fields: fields.length ? fields : ["phone"] } }; })} />
                      <span>{f === "name" ? "이름" : f === "phone" ? "연락처" : "이메일"}</span></label>
                  ))}
                </div>
                <div className="field"><label htmlFor="l-purpose">수집 목적 (동의 문구에 표시)</label><input id="l-purpose" className="input" maxLength={200} value={settings.lead.purpose} onChange={(e) => editSettings((s) => ({ ...s, lead: { ...s.lead, purpose: e.target.value } }))} /></div>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="l-ret">보관 기간</label>
                    <select id="l-ret" className="select" value={settings.lead.retentionDays} onChange={(e) => editSettings((s) => ({ ...s, lead: { ...s.lead, retentionDays: Number(e.target.value) } }))}>
                      {[90, 180, 365, 730].map((d) => <option key={d} value={d}>{d}일 후 자동 삭제</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="l-place">폼 위치</label>
                    <select id="l-place" className="select" value={settings.lead.placement} onChange={(e) => editSettings((s) => ({ ...s, lead: { ...s.lead, placement: e.target.value as Settings["lead"]["placement"] } }))}>
                      <option value="after_result">결과 아래 (공유가 더 잘 돼요)</option><option value="before_result">결과 보기 전 (입력해야 결과 공개)</option>
                    </select>
                  </div>
                </div>
                <label className="check"><input type="checkbox" checked={settings.lead.askMarketing} onChange={(e) => editSettings((s) => ({ ...s, lead: { ...s.lead, askMarketing: e.target.checked } }))} /><span>광고성 정보 수신 동의(선택)를 따로 받기</span></label>
                <p className="tiny muted">개인정보 수집·이용 동의(필수)와 만 14세 이상 확인은 항상 표시돼요. 수집한 정보는 귀사가 개인정보처리자로서 관리합니다.</p>
              </div>
            ) : null}
          </div>

          <div className="card stack">
            <label className="check"><input type="checkbox" checked={settings.coupon.enabled} onChange={(e) => editSettings((s) => ({ ...s, coupon: { ...s.coupon, enabled: e.target.checked } }))} /><span><b>쿠폰</b> — 결과 화면에 할인 코드를 보여 줘요</span></label>
            {settings.coupon.enabled ? (
              <div className="stack">
                <div className="grid-2">
                  <div className="field"><label htmlFor="c-title">쿠폰 이름</label><input id="c-title" className="input" maxLength={40} value={settings.coupon.title} onChange={(e) => editSettings((s) => ({ ...s, coupon: { ...s.coupon, title: e.target.value } }))} /></div>
                  <div className="field"><label htmlFor="c-code">기본 코드</label><input id="c-code" className="input" maxLength={40} placeholder="예) WELCOME10" value={settings.coupon.code} onChange={(e) => editSettings((s) => ({ ...s, coupon: { ...s.coupon, code: e.target.value } }))} /></div>
                </div>
                <details>
                  <summary className="small" style={{ cursor: "pointer" }}>결과마다 다른 코드 주기</summary>
                  <div className="stack" style={{ marginTop: 8 }}>
                    {content.results.map((r) => (
                      <div key={r.key} className="row"><span className="small" style={{ width: 140 }}>{r.name}</span>
                        <input aria-label={`${r.name} 코드`} className="input" style={{ flex: 1 }} maxLength={40} placeholder="비우면 기본 코드" value={settings.coupon.perResult[r.key] ?? ""}
                          onChange={(e) => editSettings((s) => { const per = { ...s.coupon.perResult }; if (e.target.value) per[r.key] = e.target.value; else delete per[r.key]; return { ...s, coupon: { ...s.coupon, perResult: per } }; })} />
                      </div>
                    ))}
                  </div>
                </details>
                <div className="field"><label htmlFor="c-note">사용 안내</label><input id="c-note" className="input" maxLength={200} placeholder="예) 매장 결제 시 화면을 보여 주세요 (~12/31)" value={settings.coupon.note} onChange={(e) => editSettings((s) => ({ ...s, coupon: { ...s.coupon, note: e.target.value } }))} /></div>
                {settings.lead.enabled ? <label className="check"><input type="checkbox" checked={settings.coupon.requireLead} onChange={(e) => editSettings((s) => ({ ...s, coupon: { ...s.coupon, requireLead: e.target.checked } }))} /><span>연락처를 남긴 사람에게만 쿠폰 공개</span></label> : null}
              </div>
            ) : null}
          </div>

          <div className="card stack">
            <label className="check"><input type="checkbox" checked={settings.cta.enabled} onChange={(e) => editSettings((s) => ({ ...s, cta: { ...s.cta, enabled: e.target.checked } }))} /><span><b>버튼</b> — 결과 화면에 내 사이트·예약 링크 버튼 달기</span></label>
            {settings.cta.enabled ? (
              <div className="grid-2">
                <div className="field"><label htmlFor="cta-l">버튼 문구</label><input id="cta-l" className="input" maxLength={30} value={settings.cta.label} onChange={(e) => editSettings((s) => ({ ...s, cta: { ...s.cta, label: e.target.value } }))} /></div>
                <div className="field"><label htmlFor="cta-u">링크</label><input id="cta-u" className="input" maxLength={500} placeholder="https://" value={settings.cta.url} onChange={(e) => editSettings((s) => ({ ...s, cta: { ...s.cta, url: e.target.value } }))} /></div>
              </div>
            ) : null}
          </div>
          {p.watermark ? <p className="small muted">무료 플랜이라 결과 화면 아래에 제작 표시가 붙어요. <Link href="/pricing">프로로 바꾸면</Link> 사라져요.</p> : null}
        </div>
      ) : null}

      {tab === "stats" ? (
        <div className="stack-lg">
          <div className="kpis">
            <div className="kpi"><b>{p.stats.views.toLocaleString("ko-KR")}</b><span>조회</span></div>
            <div className="kpi"><b>{p.stats.starts.toLocaleString("ko-KR")}</b><span>시작</span></div>
            <div className="kpi"><b>{p.stats.completes.toLocaleString("ko-KR")}</b><span>완료 {p.stats.starts ? `(${Math.round((p.stats.completes / p.stats.starts) * 100)}%)` : ""}</span></div>
            <div className="kpi"><b>{p.stats.shares.toLocaleString("ko-KR")}</b><span>공유</span></div>
            <div className="kpi"><b>{p.stats.leads.toLocaleString("ko-KR")}</b><span>리드</span></div>
            <div className="kpi"><b>{p.stats.ctaClicks.toLocaleString("ko-KR")}</b><span>버튼 클릭</span></div>
          </div>
          <div className="card stack">
            <b>결과 분포</b>
            {content.results.map((r) => {
              const n = p.stats.byResult[r.key] ?? 0;
              const pct = p.stats.completes ? Math.round((n / p.stats.completes) * 100) : 0;
              return (
                <div key={r.key} className="bar-row"><span>{r.emoji} {r.name}</span><span className="bar"><i style={{ width: `${pct}%`, background: r.color }} /></span><span className="num small">{pct}%</span></div>
              );
            })}
          </div>
          {p.stats.byDay.length > 0 ? (
            <div className="table-wrap">
              <table><thead><tr><th>날짜</th><th className="num">조회</th><th className="num">완료</th></tr></thead>
                <tbody>{p.stats.byDay.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.views}</td><td className="num">{d.completes}</td></tr>)}</tbody></table>
            </div>
          ) : <p className="muted small">발행하고 공유하면 날짜별 성과가 쌓여요.</p>}
        </div>
      ) : null}

      {tab === "leads" ? (
        <div className="stack">
          <div className="row between">
            <b>리드 {p.leadsTotal.toLocaleString("ko-KR")}건</b>
            <a className="btn btn-ghost btn-sm" href={`/api/tests/${p.testId}/leads?ws=${p.secret}`}>CSV 내려받기</a>
          </div>
          {p.leadsHidden > 0 ? <div className="notice">무료 플랜은 20건까지 보여요. {p.leadsHidden}건이 더 있어요. <Link href="/pricing">프로로 업그레이드</Link>하면 전체를 보고 내려받을 수 있어요.</div> : null}
          {p.leads.length === 0 ? <p className="muted small">아직 모인 리드가 없어요. 설정 탭에서 리드 수집을 켜고 발행해 보세요.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>일시</th><th>결과</th><th>이름</th><th>연락처</th><th>이메일</th><th>마케팅</th></tr></thead>
                <tbody>
                  {p.leads.map((l) => (
                    <tr key={l.id}><td className="num">{new Date(l.created_at).toLocaleString("ko-KR")}</td><td>{resultName(l.result_key)}</td><td>{l.name ?? ""}</td><td className="num">{l.phone ?? ""}</td><td>{l.email ?? ""}</td><td>{l.consent_marketing ? "동의" : "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="tiny muted">마케팅 문자·메일은 &lsquo;마케팅 동의&rsquo;한 사람에게만, &lsquo;(광고)&rsquo; 표시와 수신거부 방법을 넣어 보내야 해요(정보통신망법).</p>
        </div>
      ) : null}

      {tab === "share" ? (
        <div className="stack">
          {status !== "published" ? <div className="notice">아직 초안이에요. 발행하기를 눌러야 다른 사람이 볼 수 있어요.</div> : null}
          <div className="card stack">
            <b>테스트 링크</b>
            <div className="row"><code style={{ wordBreak: "break-all" }}>{p.publicUrl}</code><CopyButton text={p.publicUrl} /></div>
            <p className="small muted">카카오톡·인스타 스토리·블로그에 붙여 넣으세요. 링크 미리보기 이미지가 자동으로 붙어요.</p>
          </div>
          <div className="card stack">
            <b>홍보 문구 예시</b>
            {[
              `나 ${content.results[0]?.name ?? "○○형"}이래 ㅋㅋ 너는 뭐 나와? 👉 ${p.publicUrl}`,
              `${content.title} — ${content.questions.length}문항이면 끝! 결과 공유하고 친구랑 비교해 보세요 ${p.publicUrl}`,
            ].map((t) => <div key={t} className="row"><span className="small" style={{ flex: 1 }}>{t}</span><CopyButton text={t} /></div>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
