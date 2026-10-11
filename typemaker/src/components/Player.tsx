"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sessionId } from "@/lib/client";
import type { Result, Settings, TestContent } from "@/lib/schema";
import { computeResult } from "@/lib/scoring";
import LeadForm from "./LeadForm";

interface KakaoSdk {
  isInitialized(): boolean;
  init(key: string): void;
  Share: { sendDefault(args: Record<string, unknown>): void };
}
declare global {
  interface Window {
    Kakao?: KakaoSdk;
  }
}

/** Settings as the browser sees them. Coupon codes stay on the server and arrive via /api/coupon or /api/leads. */
export type PublicSettings = Omit<Settings, "coupon"> & { coupon: Omit<Settings["coupon"], "code" | "perResult"> };

interface Props {
  slug: string;
  content: TestContent;
  settings: PublicSettings;
  /** The test has at least one coupon code to give out. */
  couponAvailable: boolean;
  /** Result keys that have a code (every key when a default code is set). Omitted means all. */
  couponResultKeys?: string[];
  watermark: boolean;
  isHouse: boolean;
  /** Editor preview: nothing is tracked or submitted and sharing is disabled. */
  preview: boolean;
  /** Editor preview only: the owner's own, possibly unsaved, coupon settings, so codes show without a request. */
  previewCoupon?: Settings["coupon"];
  publicUrl: string;
  kakaoKey: string;
  brandName: string;
}

type Phase = { kind: "intro" } | { kind: "question"; index: number } | { kind: "gate"; resultKey: string } | { kind: "result"; resultKey: string };

/** What the participant already handed over in this browser session, so a retake never asks again. */
interface LeadState {
  resultKey: string;
  coupon: string | null;
}

const leadStorageKey = (slug: string) => `typemaker.lead.${slug}`;

function loadLead(slug: string): LeadState | null {
  try {
    const raw = window.sessionStorage.getItem(leadStorageKey(slug));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LeadState>;
    if (typeof v.resultKey !== "string") return null;
    return { resultKey: v.resultKey, coupon: typeof v.coupon === "string" ? v.coupon : null };
  } catch {
    return null;
  }
}

function storeLead(slug: string, lead: LeadState): void {
  try {
    window.sessionStorage.setItem(leadStorageKey(slug), JSON.stringify(lead));
  } catch {
    /* private mode: the state still lives in memory for this page */
  }
}

// ---------------------------------------------------------------- readable text on result colors

const DARK_INK = "#15172b";
const LIGHT_INK = "#ffffff";

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb color, or null when it is not one. */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colors (1 when either is not one). */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Dark or white text, whichever has the higher WCAG contrast ratio on `bg`. */
export function readableInk(bg: string): string {
  if (luminance(bg) === null) return LIGHT_INK;
  return contrast(bg, DARK_INK) > contrast(bg, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}

type HeroResult = Pick<Result, "name" | "emoji" | "tagline" | "traits" | "color">;

/** The colored result card. Also used by the shared-result page, so both pick text color the same way. */
export function ResultHero({ result, label }: { result: HeroResult; label?: string }) {
  const ink = readableInk(result.color);
  return (
    <div className={ink === DARK_INK ? "result-hero on-light" : "result-hero"} style={{ background: result.color, color: ink }}>
      {label ? <span className="small" style={{ opacity: 0.9 }}>{label}</span> : null}
      {result.emoji ? <span className="emoji" aria-hidden="true">{result.emoji}</span> : null}
      <h2>{result.name}</h2>
      {result.tagline ? <p style={{ fontWeight: 600 }}>{result.tagline}</p> : null}
      {result.traits.length ? <div className="traits">{result.traits.map((t, i) => <span key={`${i}-${t}`}>#{t}</span>)}</div> : null}
    </div>
  );
}

/** Accent-colored full-width link whose text color follows the accent's contrast (for server pages). */
export function AccentLinkButton({ href, accent, children }: { href: string; accent: string; children: React.ReactNode }) {
  return <a href={href} className="btn btn-primary btn-block" style={{ background: accent, color: readableInk(accent) }}>{children}</a>;
}

// ---------------------------------------------------------------- player

export default function Player(p: Props) {
  const { content, settings } = p;
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [lead, setLead] = useState<LeadState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const viewed = useRef(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const accent = settings.theme.accent;

  function track(type: string, extra: { resultKey?: string; channel?: string } = {}) {
    if (p.preview) return;
    const body = JSON.stringify({ slug: p.slug, type, resultKey: extra.resultKey ?? null, channel: extra.channel ?? null, sessionId: sessionId() });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      else void fetch("/api/events", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    } catch {
      /* analytics must never break the test */
    }
  }

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("view");
    if (!p.preview) setLead(loadLead(p.slug));
  }, []);

  useEffect(() => {
    if (!p.kakaoKey || window.Kakao) return;
    const s = document.createElement("script");
    s.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js";
    s.async = true;
    s.onload = () => {
      if (window.Kakao && !window.Kakao.isInitialized()) window.Kakao.init(p.kakaoKey);
    };
    document.head.appendChild(s);
  }, [p.kakaoKey]);

  // Each question is a fresh subtree (keyed by id); move focus to its heading so screen readers announce it.
  useEffect(() => {
    if (phase.kind === "question" && phase.index > 0) questionHeading.current?.focus({ preventScroll: true });
  }, [phase]);

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 1800);
  }

  function toTop() {
    if (!p.preview) window.scrollTo({ top: 0 });
  }

  function showResult(resultKey: string) {
    setPhase({ kind: "result", resultKey });
    toTop();
  }

  function leadSubmitted(resultKey: string, coupon: string | null) {
    const next = { resultKey, coupon };
    setLead(next);
    if (!p.preview) storeLead(p.slug, next);
  }

  function choose(questionId: string, optionId: string, index: number) {
    const next = { ...answers, [questionId]: optionId };
    setAnswers(next);
    if (index + 1 < content.questions.length) {
      setPhase({ kind: "question", index: index + 1 });
      return;
    }
    const resultKey = computeResult(content, next);
    track("complete", { resultKey });
    // Someone who already left their details in this session goes straight to the result.
    if (settings.lead.enabled && settings.lead.placement === "before_result" && !lead) {
      setPhase({ kind: "gate", resultKey });
      toTop();
    } else showResult(resultKey);
  }

  const style = { ["--t-accent" as string]: accent } as React.CSSProperties;
  const themeClass = settings.theme.style === "night" ? "theme-night" : settings.theme.style === "calm" ? "theme-calm" : "";
  const couponGated = settings.coupon.enabled && settings.coupon.requireLead && settings.lead.enabled;
  const night = settings.theme.style === "night";
  // Accent-colored text only where it stays readable on the card (pastel accents fall back to the body color).
  const accentText = contrast(accent, night ? "#1b1d2e" : "#ffffff") >= 4.5 ? accent : undefined;

  return (
    <div className={`player ${themeClass}`} style={{ ...style, background: night ? "#12131f" : undefined }}>
      <div className="narrow" style={{ maxWidth: 560 }}>
        {p.preview ? <div className="notice" style={{ marginBottom: 12 }}>미리보기예요. 참여 기록과 입력한 연락처는 저장되지 않아요.</div> : null}
        <div className="player-card">
          {phase.kind === "intro" ? (
            <div className="stack center">
              {settings.brandName ? <span className="pill" style={{ justifySelf: "center", background: `${accent}22`, color: accentText ?? "var(--ink)" }}>{settings.brandName}</span> : null}
              <h1 className="q-text" style={{ fontSize: "clamp(28px, 7vw, 38px)" }}>{content.title}</h1>
              {content.subtitle ? <p className="muted">{content.subtitle}</p> : null}
              {content.intro ? <p className="small muted">{content.intro}</p> : null}
              <div className="row" style={{ justifyContent: "center" }}>
                {content.results.slice(0, 8).map((r) => <span key={r.key} style={{ fontSize: 28 }} aria-hidden="true">{r.emoji}</span>)}
              </div>
              <button type="button" className="btn btn-primary btn-block" style={{ background: accent, color: readableInk(accent) }} onClick={() => { track("start"); setPhase({ kind: "question", index: 0 }); }}>
                시작하기
              </button>
              <p className="tiny muted">{content.questions.length}문항 · 약 {Math.max(1, Math.round(content.questions.length * 0.15))}분</p>
            </div>
          ) : null}

          {phase.kind === "question" ? (() => {
            const q = content.questions[phase.index];
            if (!q) return null;
            return (
              // key: a new question gets new option buttons, so no hover, focus or press state carries over.
              <div className="stack" key={q.id}>
                <div className="row between small muted"><span className="num">{phase.index + 1} / {content.questions.length}</span>
                  {phase.index > 0 ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase({ kind: "question", index: phase.index - 1 })}>이전</button> : <span />}
                </div>
                <div className="progress" aria-hidden="true"><i style={{ width: `${((phase.index + 1) / content.questions.length) * 100}%` }} /></div>
                <h2 className="q-text" ref={questionHeading} tabIndex={-1} style={{ outline: "none" }}>{q.text}</h2>
                <div className="stack" style={{ gap: 10 }}>
                  {q.options.map((o) => (
                    <button key={o.id} type="button" className="option" aria-pressed={answers[q.id] === o.id} onClick={() => choose(q.id, o.id, phase.index)}
                      style={answers[q.id] === o.id ? { borderColor: accent } : undefined}>{o.text}</button>
                  ))}
                </div>
              </div>
            );
          })() : null}

          {phase.kind === "gate" ? (
            <div className="stack">
              <h2 className="q-text center">결과가 준비됐어요!</h2>
              <div className="stack center" style={{ gap: 4 }}>
                <b>{settings.lead.headline}</b>
                <p className="muted small">원하지 않으면 정보를 남기지 않고 결과만 볼 수 있어요.</p>
              </div>
              <LeadForm slug={p.slug} settings={settings} resultKey={phase.resultKey} preview={p.preview} accentInk={readableInk(accent)}
                onDone={(coupon) => { leadSubmitted(phase.resultKey, coupon); showResult(phase.resultKey); }} />
              <button type="button" className="btn btn-ghost btn-block" onClick={() => showResult(phase.resultKey)}>건너뛰고 결과 보기</button>
              {couponGated && p.couponAvailable ? <p className="tiny muted center">건너뛰면 쿠폰 코드는 열리지 않아요.</p> : null}
            </div>
          ) : null}

          {phase.kind === "result" ? (
            <ResultView
              {...p}
              resultKey={phase.resultKey}
              lead={lead}
              onLeadDone={(coupon) => leadSubmitted(phase.resultKey, coupon)}
              onRetry={() => { setAnswers({}); setPhase({ kind: "intro" }); toTop(); }}
              track={track}
              flash={flash}
            />
          ) : null}
        </div>
        {toast ? <div role="status" style={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)", background: "#15172b", color: "#fff", padding: "10px 16px", borderRadius: 999, fontSize: 14, zIndex: 60, maxWidth: "calc(100vw - 32px)" }}>{toast}</div> : null}
      </div>
    </div>
  );
}

type ResultViewProps = Props & {
  resultKey: string;
  lead: LeadState | null;
  onLeadDone: (coupon: string | null) => void;
  onRetry: () => void;
  track: (t: string, e?: { resultKey?: string; channel?: string }) => void;
  flash: (t: string) => void;
};

type CouponView = { kind: "none" } | { kind: "locked" } | { kind: "loading" } | { kind: "code"; code: string; fromLead: boolean };

function ResultView(p: ResultViewProps) {
  const { content, settings } = p;
  const result = content.results.find((r) => r.key === p.resultKey) ?? content.results[0];
  const match = useMemo(() => content.results.find((r) => r.key === result?.bestMatch), [content.results, result]);
  const resultKey = result?.key ?? "";
  const leadDone = p.lead !== null;
  const gated = settings.coupon.requireLead && settings.lead.enabled;
  const hasCoupon = settings.coupon.enabled && p.couponAvailable && (!p.couponResultKeys || p.couponResultKeys.includes(resultKey));
  // Ungated codes are fetched for this result; gated ones only ever come back from /api/leads.
  const [fetched, setFetched] = useState<{ key: string; code: string | null } | null>(null);
  const needsFetch = !p.preview && hasCoupon && !gated && resultKey !== "";

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    fetch(`/api/coupon?slug=${encodeURIComponent(p.slug)}&key=${encodeURIComponent(resultKey)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ code: string | null }>) : { code: null }))
      .catch(() => ({ code: null }))
      .then((d) => {
        if (!cancelled) setFetched({ key: resultKey, code: typeof d.code === "string" && d.code ? d.code : null });
      });
    return () => {
      cancelled = true;
    };
  }, [needsFetch, p.slug, resultKey]);

  if (!result) return null;
  const resultUrl = `${p.publicUrl}/r/${result.key}`;
  const shareText = `나는 「${result.name}」! ${content.title} 해 보기`;

  let coupon: CouponView = { kind: "none" };
  if (settings.coupon.enabled) {
    if (p.preview) {
      const pc = p.previewCoupon;
      const code = pc ? (Object.hasOwn(pc.perResult, result.key) ? pc.perResult[result.key] : "") || pc.code || null : null;
      if (code) coupon = gated && !leadDone ? { kind: "locked" } : { kind: "code", code, fromLead: false };
    } else if (hasCoupon && gated) {
      if (!p.lead) coupon = { kind: "locked" };
      else if (p.lead.coupon) coupon = { kind: "code", code: p.lead.coupon, fromLead: p.lead.resultKey !== result.key };
    } else if (hasCoupon) {
      if (!fetched || fetched.key !== result.key) coupon = { kind: "loading" };
      else if (fetched.code) coupon = { kind: "code", code: fetched.code, fromLead: false };
    }
  }

  async function share(channel: "kakao" | "native" | "copy") {
    if (p.preview) {
      p.flash("미리보기에서는 공유되지 않아요. 발행 후에 써 보세요.");
      return;
    }
    p.track("share", { resultKey: result?.key, channel });
    if (channel === "kakao" && window.Kakao?.isInitialized()) {
      window.Kakao.Share.sendDefault({
        objectType: "feed",
        content: { title: shareText, description: result?.tagline ?? "", imageUrl: `${new URL(p.publicUrl).origin}/api/og?slug=${p.slug}&key=${result?.key ?? ""}`, link: { mobileWebUrl: resultUrl, webUrl: resultUrl } },
        buttons: [{ title: "나도 해 보기", link: { mobileWebUrl: p.publicUrl, webUrl: p.publicUrl } }],
      });
      return;
    }
    if (channel === "native" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: content.title, text: shareText, url: resultUrl });
        return;
      } catch {
        /* user cancelled: fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${resultUrl}`);
      p.flash("링크를 복사했어요");
    } catch {
      window.prompt("아래 링크를 복사하세요", resultUrl);
    }
  }

  const storyImage = `/api/og?slug=${p.slug}&key=${result.key}&format=story`;

  return (
    <div className="stack">
      <ResultHero result={result} label="나의 결과는" />
      {result.description ? <p style={{ whiteSpace: "pre-wrap" }}>{result.description}</p> : null}
      {match ? (
        <div className="card card-tight row">
          <span style={{ fontSize: 26 }} aria-hidden="true">{match.emoji}</span>
          <div><div className="tiny muted">찰떡궁합</div><b>{match.name}</b></div>
        </div>
      ) : null}

      <div className="stack" style={{ gap: 8 }}>
        {p.kakaoKey ? <button type="button" className="btn btn-block" style={{ background: "#FEE500", color: "#191919" }} onClick={() => share("kakao")}>카카오톡으로 공유</button> : null}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-dark" style={{ flex: "1 1 120px", paddingInline: 12 }} onClick={() => share("native")}>결과 공유하기</button>
          <button type="button" className="btn btn-ghost" style={{ flex: "1 1 120px", paddingInline: 12 }} onClick={() => share("copy")}>링크 복사</button>
        </div>
        {p.preview ? (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => p.flash("결과 이미지는 발행한 뒤에 만들어져요.")}>결과 이미지 저장 (인스타 스토리용)</button>
        ) : (
          <a className="btn btn-ghost btn-block" href={storyImage} target="_blank" rel="noreferrer" onClick={() => p.track("share", { resultKey: result.key, channel: "image" })}>결과 이미지 저장 (인스타 스토리용)</a>
        )}
      </div>

      {settings.lead.enabled && !leadDone ? (
        <div className="card stack">
          <b>{settings.lead.headline}</b>
          <LeadForm slug={p.slug} settings={settings} resultKey={result.key} preview={p.preview} accentInk={readableInk(settings.theme.accent)} onDone={p.onLeadDone} />
        </div>
      ) : null}
      {leadDone && settings.lead.enabled ? <p className="small center">고마워요! 남겨 주신 정보로 안내드릴게요.</p> : null}

      {coupon.kind !== "none" ? (
        <div className="coupon" aria-live="polite">
          <b>{settings.coupon.title}</b>
          {coupon.kind === "locked" ? <span className="small muted">연락처를 남기면 쿠폰 코드가 열려요.</span> : null}
          {coupon.kind === "loading" ? <span className="small muted">쿠폰을 불러오는 중…</span> : null}
          {coupon.kind === "code" ? (
            <>
              <code onClick={() => p.track("coupon_reveal", { resultKey: result.key })}>{coupon.code}</code>
              {coupon.fromLead ? <span className="tiny muted">연락처를 남길 때 받은 쿠폰이에요.</span> : null}
              {settings.coupon.note ? <span className="tiny muted">{settings.coupon.note}</span> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {settings.cta.enabled && /^https?:\/\//i.test(settings.cta.url) ? (
        <a className="btn btn-primary btn-block" style={{ background: settings.theme.accent, color: readableInk(settings.theme.accent) }} href={settings.cta.url} target="_blank" rel="noopener" onClick={() => p.track("cta_click", { resultKey: result.key })}>{settings.cta.label}</a>
      ) : null}

      <details className="card card-tight">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>다른 유형도 보기</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          {content.results.map((r) => (
            <div key={r.key} className="row small">
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 999, background: r.color, flex: "none" }} />
              <span aria-hidden="true">{r.emoji}</span><b>{r.name}</b><span className="muted">{r.tagline}</span>
            </div>
          ))}
        </div>
      </details>

      <button type="button" className="btn btn-ghost btn-block" onClick={p.onRetry}>다시 하기</button>

      {p.watermark ? (
        p.preview ? (
          <span className="watermark">{p.isHouse ? "우리 브랜드 테스트도 만들 수 있어요 · " : `${p.brandName}에서 만든 테스트예요 · `}<b>나도 만들기 →</b></span>
        ) : (
          <a className="watermark" href={`/create?ref=${p.slug}`} onClick={() => p.track("watermark_click")}>
            {p.isHouse ? "우리 브랜드 테스트도 만들 수 있어요 · " : `${p.brandName}에서 만든 테스트예요 · `}<b>나도 만들기 →</b>
          </a>
        )
      ) : null}
      <p className="tiny muted center">이 테스트는 재미를 위한 콘텐츠이며 AI가 생성한 문구를 포함할 수 있어요.</p>
    </div>
  );
}
