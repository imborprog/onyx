"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ZodIssue } from "zod";
import { api } from "@/lib/client";
import type { Plan } from "@/lib/config";
import { SettingsSchema, TestContentSchema, type Settings, type TestContent } from "@/lib/schema";
import { resultReach } from "@/lib/scoring";
import type { TestStats } from "@/lib/repo";
import Player, { type PublicSettings } from "./Player";
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
  /** House (operator) workspace: its tests always carry the watermark, like the public page. */
  isHouse: boolean;
  /** Service name, shown in the preview's watermark. */
  brandName: string;
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

type ResultItem = TestContent["results"][number];

/**
 * A key no result has ever used. Stored events, leads and coupon codes refer to results by key,
 * so a new result must not inherit a deleted one's key (and with it that result's history).
 */
function nextKey(results: ResultItem[], used: Iterable<string>): string {
  let max = 0;
  for (const k of [...results.map((r) => r.key), ...used]) {
    const m = /^r(\d+)$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let i = max + 1;
  while (results.some((r) => r.key === `r${i}`)) i++;
  return `r${i}`;
}

function ownCode(per: Record<string, string>, key: string): string {
  return Object.hasOwn(per, key) ? (per[key] ?? "") : "";
}

function parseTraits(raw: string): string[] {
  const list = raw.split(/[,，]/).map((x) => x.trim().slice(0, 40)).filter(Boolean);
  return [...new Set(list)].slice(0, 6);
}

/** Keeps what the owner types (commas, trailing spaces) and only tidies the text when the field loses focus. */
function TraitsInput({ id, traits, onChange }: { id: string; traits: string[]; onChange: (traits: string[]) => void }) {
  const [raw, setRaw] = useState(() => traits.join(", "));
  return (
    <input id={id} aria-label="특징 키워드" className="input" placeholder="특징 키워드 (쉼표로 구분, 최대 6개)" value={raw} maxLength={300}
      onChange={(e) => { setRaw(e.target.value); onChange(parseTraits(e.target.value)); }}
      onBlur={() => setRaw(parseTraits(raw).join(", "))} />
  );
}

// ---------------------------------------------------------------- validation messages

interface Problem {
  tab: Tab;
  text: string;
  /** id of the input to focus. */
  field?: string;
}

function tooLong(issue: ZodIssue): number | null {
  return issue.code === "too_big" && typeof issue.maximum === "number" ? issue.maximum : null;
}

/** A Korean message that says which field is wrong, for zod issues on the test content. */
function contentProblem(issue: ZodIssue, c: TestContent): Problem {
  const [k0, i1, k2, i3, k4] = issue.path;
  const max = tooLong(issue);
  const p = (text: string, field?: string): Problem => ({ tab: "content", text, field });
  if (k0 === "title") return p(max ? `제목은 ${max}자까지 쓸 수 있어요.` : "제목을 입력해 주세요.", "t-title");
  if (k0 === "subtitle") return p(`부제는 ${max ?? 120}자까지 쓸 수 있어요.`, "t-sub");
  if (k0 === "intro") return p(`시작 화면 안내는 ${max ?? 400}자까지 쓸 수 있어요.`, "t-intro");
  if (k0 === "questions" && typeof i1 === "number") {
    const q = `Q${i1 + 1}`;
    if (k2 === "text") return p(max ? `${q} 질문은 ${max}자까지 쓸 수 있어요.` : `${q} 질문 문구가 비어 있어요.`, `q-${i1}-text`);
    if (k2 === "options" && typeof i3 === "number") {
      const field = `q-${i1}-o-${i3}`;
      if (k4 === "text") return p(max ? `${q}의 보기 ${i3 + 1} 문구는 ${max}자까지 쓸 수 있어요.` : `${q}의 보기 ${i3 + 1} 문구가 비어 있어요.`, field);
      return p(`${q}의 보기 ${i3 + 1} 점수 설정을 확인해 주세요.`, field);
    }
    if (k2 === "options") return p(`${q}에는 보기가 2~4개 있어야 해요.`, `q-${i1}-text`);
    return p(`${q} 내용을 확인해 주세요.`, `q-${i1}-text`);
  }
  if (k0 === "questions") return p("질문은 3~15개여야 해요.");
  if (k0 === "results" && typeof i1 === "number") {
    const r = c.results[i1];
    const who = r?.name.trim() ? `「${r.name.trim()}」 결과` : `${i1 + 1}번째 결과 유형`;
    if (k2 === "name") return p(max ? `${who} 이름은 ${max}자까지 쓸 수 있어요.` : `${i1 + 1}번째 결과 유형의 이름을 입력해 주세요.`, `r-${i1}-name`);
    if (k2 === "emoji") return p(`${who}의 이모지는 ${max ?? 8}자까지 넣을 수 있어요.`, `r-${i1}-emoji`);
    if (k2 === "tagline") return p(`${who}의 한 줄 요약은 ${max ?? 100}자까지 쓸 수 있어요.`, `r-${i1}-tagline`);
    if (k2 === "description") return p(`${who}의 설명은 ${max ?? 900}자까지 쓸 수 있어요.`, `r-${i1}-desc`);
    if (k2 === "traits") return p(`${who}의 특징 키워드는 6개까지, 하나에 40자까지 쓸 수 있어요.`, `r-${i1}-traits`);
    if (k2 === "color") return p(`${who}의 색을 다시 골라 주세요.`, `r-${i1}-name`);
    return p(`${who} 내용을 확인해 주세요.`, `r-${i1}-name`);
  }
  if (k0 === "results") return p("결과 유형은 2~12개여야 해요.");
  return p("질문·결과 내용을 확인해 주세요.");
}

const SETTING_FIELDS: Record<string, { id: string; label: string }> = {
  brandName: { id: "s-brand", label: "브랜드 이름" },
  "lead.headline": { id: "l-head", label: "폼 제목" },
  "lead.purpose": { id: "l-purpose", label: "수집 목적" },
  "coupon.title": { id: "c-title", label: "쿠폰 이름" },
  "coupon.code": { id: "c-code", label: "기본 코드" },
  "coupon.note": { id: "c-note", label: "사용 안내" },
  "cta.label": { id: "cta-l", label: "버튼 문구" },
  "cta.url": { id: "cta-u", label: "버튼 링크" },
};

function settingsProblem(issue: ZodIssue, c: TestContent): Problem {
  const max = tooLong(issue);
  if (issue.path[0] === "coupon" && issue.path[1] === "perResult" && typeof issue.path[2] === "string") {
    const key = issue.path[2];
    const name = c.results.find((r) => r.key === key)?.name ?? "결과";
    return { tab: "settings", text: `「${name}」 쿠폰 코드는 ${max ?? 40}자까지 쓸 수 있어요.`, field: `c-per-${key}` };
  }
  const f = SETTING_FIELDS[issue.path.join(".")];
  if (!f) return { tab: "settings", text: "리드·쿠폰·디자인 설정을 확인해 주세요." };
  return { tab: "settings", text: max ? `${f.label} 칸은 ${max}자까지 쓸 수 있어요.` : `${f.label} 칸을 확인해 주세요.`, field: f.id };
}

/** Checks the schema can't express (or words badly), in the order the owner sees the fields. */
function extraProblem(c: TestContent, s: Settings): Problem | null {
  const reach = resultReach(c);
  const ri = c.results.findIndex((r) => !reach[r.key]);
  const unreachable = c.results[ri];
  if (unreachable) {
    return { tab: "content", text: `「${unreachable.name || `${ri + 1}번째 결과`}」 결과가 나올 수 있는 보기가 없어요. 질문의 보기 중 하나가 이 결과에 점수를 주도록 바꿔 주세요.`, field: `r-${ri}-name` };
  }
  if (s.lead.enabled && !s.lead.purpose.trim()) return { tab: "settings", text: "수집 목적을 적어 주세요. 참여자 동의 문구에 그대로 표시돼요.", field: "l-purpose" };
  if (s.cta.enabled && !s.cta.label.trim()) return { tab: "settings", text: "버튼 문구를 입력해 주세요.", field: "cta-l" };
  if (s.cta.enabled && !/^https?:\/\/\S+$/.test(s.cta.url.trim())) return { tab: "settings", text: "버튼 링크는 https:// 로 시작하는 주소로 넣어 주세요.", field: "cta-u" };
  return null;
}

/** Drops codes of results that no longer exist and blank entries, so deleted results leave nothing behind. */
function cleanSettings(s: Settings, c: TestContent): Settings {
  const keys = new Set(c.results.map((r) => r.key));
  const perResult = Object.fromEntries(Object.entries(s.coupon.perResult).map(([k, v]) => [k, v.trim()] as const).filter(([k, v]) => keys.has(k) && v));
  return { ...s, cta: { ...s.cta, url: s.cta.url.trim() }, coupon: { ...s.coupon, code: s.coupon.code.trim(), perResult } };
}

function focusField(id: string | undefined) {
  if (!id) return;
  window.setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const details = el.closest("details");
    if (details && !details.open) details.open = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, 30);
}

export default function Editor(p: Props) {
  const [tab, setTab] = useState<Tab>("content");
  const [content, setContent] = useState<TestContent>(p.initialContent);
  const [settings, setSettings] = useState<Settings>(p.initialSettings);
  const [status, setStatus] = useState<Status>(p.initialStatus);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [previewRun, setPreviewRun] = useState(0);
  const closePreview = useCallback(() => setPreviewRun(0), []);
  // Bumped on every edit; a save only clears `dirty` if nothing changed while its request was in flight.
  const editVersion = useRef(0);
  // Keys that stored stats, leads or coupon codes refer to, plus keys deleted in this session: never handed out again.
  const usedKeys = useRef<Set<string>>(
    new Set([
      ...p.initialContent.results.map((r) => r.key),
      ...Object.keys(p.stats.byResult),
      ...p.leads.flatMap((l) => (l.result_key ? [l.result_key] : [])),
      ...Object.keys(p.initialSettings.coupon.perResult),
    ]),
  );

  const reach = useMemo(() => resultReach(content), [content]);
  const maxReach = Math.max(1, ...Object.values(reach));

  function editContent(fn: (c: TestContent) => TestContent) {
    setContent((c) => fn(structuredClone(c)));
    editVersion.current += 1;
    setDirty(true);
  }
  function editSettings(fn: (s: Settings) => Settings) {
    setSettings((s) => fn(structuredClone(s)));
    editVersion.current += 1;
    setDirty(true);
  }

  // Warn before a reload, tab close or in-app link would drop unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // Next.js links navigate on the client, where beforeunload never fires; ask before React sees the click.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm("저장하지 않은 변경사항이 있어요. 저장하지 않고 이 페이지를 떠날까요?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function fail(problem: Problem): false {
    setMsg({ kind: "err", text: problem.text });
    setTab(problem.tab);
    focusField(problem.field);
    return false;
  }

  async function save(): Promise<boolean> {
    const c = TestContentSchema.safeParse(content);
    if (!c.success) {
      // Field-level issues first (empty text, too long); the cross-field checks only make sense after those.
      const issue = c.error.issues.find((i) => i.code !== "custom");
      if (issue) return fail(contentProblem(issue, content));
    }
    const extra = extraProblem(content, settings);
    if (extra) return fail(extra);
    if (!c.success) return fail({ tab: "content", text: "질문·결과 구성을 확인해 주세요. 같은 이름의 항목이 겹쳤을 수 있어요." });
    const s = SettingsSchema.safeParse(cleanSettings(settings, c.data));
    if (!s.success) {
      const issue = s.error.issues[0];
      return fail(issue ? settingsProblem(issue, content) : { tab: "settings", text: "설정을 확인해 주세요." });
    }
    const version = editVersion.current;
    setSaving(true);
    try {
      await api(`/api/tests/${p.testId}`, { method: "PATCH", workspace: p.secret, body: { content: c.data, settings: s.data } });
      if (editVersion.current === version) {
        setDirty(false);
        setSettings(s.data);
        setMsg({ kind: "ok", text: "저장했어요" });
      } else {
        setMsg({ kind: "ok", text: "저장했어요. 저장하는 동안 바뀐 내용은 아직 저장 전이에요." });
      }
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

  const resultName = (key: string | null) => content.results.find((r) => r.key === key)?.name ?? (key ? "삭제된 유형" : "-");
  const { code: _code, perResult: _perResult, ...publicCoupon } = settings.coupon;
  const previewSettings: PublicSettings = { ...settings, coupon: publicCoupon };
  const couponMissing = settings.coupon.enabled && !settings.coupon.code.trim() ? content.results.filter((r) => !ownCode(settings.coupon.perResult, r.key).trim()) : [];

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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewRun((n) => n + 1)}>미리보기</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={save} disabled={saving || !dirty}>{saving ? "저장 중…" : "저장"}</button>
          {status === "published" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeStatus("draft")}>발행 중지</button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => changeStatus("published")}>발행하기</button>
          )}
        </div>
      </div>
      {msg ? <p className={msg.kind === "err" ? "error" : "small"} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</p> : null}
      {previewRun > 0 ? (
        <PreviewOverlay onClose={closePreview}>
          <Player
            key={previewRun}
            slug={p.slug}
            content={content}
            settings={previewSettings}
            couponAvailable={settings.coupon.enabled && couponMissing.length < content.results.length}
            preview
            previewCoupon={settings.coupon}
            watermark={p.watermark || p.isHouse}
            isHouse={p.isHouse}
            publicUrl={p.publicUrl}
            kakaoKey=""
            brandName={p.brandName}
          />
        </PreviewOverlay>
      ) : null}

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
                onClick={() => editContent((c) => ({ ...c, results: [...c.results, { key: nextKey(c.results, usedKeys.current), name: "새 유형", emoji: "✨", tagline: "", description: "", traits: [], bestMatch: null, color: "#2f6fed" }] }))}>
                결과 추가
              </button>
            </div>
            {content.results.map((r, ri) => (
              <div key={r.key} className="q-edit">
                <div className="row">
                  <input id={`r-${ri}-emoji`} aria-label="이모지" className="input" style={{ width: 64 }} maxLength={8} value={r.emoji} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).emoji = e.target.value; return c; })} />
                  <input id={`r-${ri}-name`} aria-label="결과 이름" className="input" style={{ flex: "1 1 140px", minWidth: 0 }} maxLength={40} value={r.name} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).name = e.target.value; return c; })} />
                  <input aria-label="색" type="color" value={r.color} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).color = e.target.value; return c; })} style={{ width: 44, height: 40, border: 0, background: "none" }} />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={content.results.length <= 2}
                    onClick={() => {
                      const gone = r.key;
                      usedKeys.current.add(gone);
                      editContent((c) => {
                        c.results.splice(ri, 1);
                        for (const q of c.questions) for (const o of q.options) {
                          o.weights = o.weights.filter((w) => w.key !== gone);
                          if (o.weights.length === 0) o.weights = [{ key: (c.results[0] as typeof r).key, points: 1 }];
                        }
                        for (const x of c.results) if (x.bestMatch === gone) x.bestMatch = null;
                        return c;
                      });
                      // The deleted result's coupon code must not linger (or pass to a later result).
                      editSettings((s) => {
                        if (!Object.hasOwn(s.coupon.perResult, gone)) return s;
                        const per = { ...s.coupon.perResult };
                        delete per[gone];
                        return { ...s, coupon: { ...s.coupon, perResult: per } };
                      });
                    }}>삭제</button>
                </div>
                <input id={`r-${ri}-tagline`} aria-label="한 줄 요약" className="input" maxLength={100} placeholder="한 줄 요약" value={r.tagline} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).tagline = e.target.value; return c; })} />
                <textarea id={`r-${ri}-desc`} aria-label="설명" className="textarea" maxLength={900} placeholder="결과 설명" value={r.description} onChange={(e) => editContent((c) => { (c.results[ri] as typeof r).description = e.target.value; return c; })} />
                <div className="grid-2">
                  <TraitsInput id={`r-${ri}-traits`} traits={r.traits} onChange={(traits) => editContent((c) => { (c.results[ri] as typeof r).traits = traits; return c; })} />
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
                  <input id={`q-${qi}-text`} aria-label={`질문 ${qi + 1}`} className="input" style={{ flex: "1 1 180px", minWidth: 0 }} maxLength={140} value={q.text} onChange={(e) => editContent((c) => { (c.questions[qi] as typeof q).text = e.target.value; return c; })} />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={content.questions.length <= 3} onClick={() => editContent((c) => { c.questions.splice(qi, 1); return c; })}>삭제</button>
                </div>
                {q.options.map((o, oi) => {
                  const w = o.weights[0];
                  return (
                    <div key={o.id} className="opt-edit">
                      <input id={`q-${qi}-o-${oi}`} aria-label={`Q${qi + 1} 보기 ${oi + 1}`} className="input" maxLength={100} value={o.text} onChange={(e) => editContent((c) => { ((c.questions[qi] as typeof q).options[oi] as typeof o).text = e.target.value; return c; })} />
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
                    onClick={() => editContent((c) => {
                      const qq = c.questions[qi] as typeof q;
                      const taken = new Set(qq.options.map((o) => o.id));
                      const id = [..."abcdefgh"].find((x) => !taken.has(x)) ?? `o${qq.options.length + 1}`;
                      qq.options.push({ id, text: "새 보기", weights: [{ key: (c.results[0] as ResultItem).key, points: 1 }] });
                      return c;
                    })}>보기 추가</button>
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
                      <option value="after_result">결과 아래 (공유가 더 잘 돼요)</option><option value="before_result">결과 보기 전 (건너뛰기 가능)</option>
                    </select>
                  </div>
                </div>
                {settings.lead.placement === "before_result" ? (
                  <p className="tiny muted">참여자는 정보를 남기지 않고 &lsquo;건너뛰고 결과 보기&rsquo;를 누를 수 있어요. 결과 보기에 꼭 필요하지 않은 개인정보를 이유로 결과를 막을 수는 없어서예요(개인정보보호법 제16조). 쿠폰은 &lsquo;연락처를 남긴 사람에게만 공개&rsquo;로 설정할 수 있어요.</p>
                ) : null}
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
                      <div key={r.key} className="row"><span className="small" style={{ flex: "0 1 140px", minWidth: 0 }}>{r.name}</span>
                        <input id={`c-per-${r.key}`} aria-label={`${r.name} 코드`} className="input" style={{ flex: "1 1 160px", minWidth: 0 }} maxLength={40} placeholder="비우면 기본 코드" value={ownCode(settings.coupon.perResult, r.key)}
                          onChange={(e) => editSettings((s) => { const per = { ...s.coupon.perResult }; if (e.target.value) per[r.key] = e.target.value; else delete per[r.key]; return { ...s, coupon: { ...s.coupon, perResult: per } }; })} />
                      </div>
                    ))}
                  </div>
                </details>
                <div className="field"><label htmlFor="c-note">사용 안내</label><input id="c-note" className="input" maxLength={200} placeholder="예) 매장 결제 시 화면을 보여 주세요 (~12/31)" value={settings.coupon.note} onChange={(e) => editSettings((s) => ({ ...s, coupon: { ...s.coupon, note: e.target.value } }))} /></div>
                {couponMissing.length > 0 ? (
                  <p className="tiny" style={{ color: "var(--warn)" }}>
                    {couponMissing.length === content.results.length ? "코드가 비어 있어서 쿠폰이 보이지 않아요. 기본 코드를 넣어 주세요." : `코드가 없는 결과(${couponMissing.map((r) => r.name).join(", ")})에는 쿠폰이 보이지 않아요. 기본 코드를 넣거나 결과마다 코드를 넣어 주세요.`}
                  </p>
                ) : null}
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
            <a className="btn btn-ghost btn-sm" href={`/api/tests/${p.testId}/leads?ws=${p.secret}`} download>CSV 내려받기</a>
          </div>
          {p.leadsHidden > 0 ? <div className="notice">무료 플랜은 20건까지 보여요. {p.leadsHidden}건이 더 있어요. <Link href="/pricing">프로로 업그레이드</Link>하면 전체를 보고 내려받을 수 있어요.</div> : null}
          {p.leads.length === 0 ? <p className="muted small">아직 모인 리드가 없어요. 설정 탭에서 리드 수집을 켜고 발행해 보세요.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>일시</th><th>결과</th><th>이름</th><th>연락처</th><th>이메일</th><th>마케팅</th></tr></thead>
                <tbody>
                  {p.leads.map((l) => (
                    <tr key={l.id}><td className="num">{new Date(l.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td><td>{resultName(l.result_key)}</td><td>{l.name ?? ""}</td><td className="num">{l.phone ?? ""}</td><td>{l.email ?? ""}</td><td>{l.consent_marketing ? "동의" : "-"}</td></tr>
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

/** Full-screen preview of the unsaved test. Player runs in preview mode: nothing is tracked, stored or shared. */
function PreviewOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      prevFocus?.focus();
    };
  }, [onClose]);
  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="테스트 미리보기">
      <div className="preview-bar">
        <span className="small"><b>미리보기</b> · 저장하지 않은 내용도 보여요</span>
        <button ref={closeRef} type="button" className="btn btn-dark btn-sm" onClick={onClose}>닫기</button>
      </div>
      {children}
    </div>
  );
}
