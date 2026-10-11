"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sessionId } from "@/lib/client";
import type { Settings, TestContent } from "@/lib/schema";
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

interface Props {
  slug: string;
  content: TestContent;
  settings: Settings;
  watermark: boolean;
  isHouse: boolean;
  preview: boolean;
  publicUrl: string;
  kakaoKey: string;
  brandName: string;
  initialResult?: string | null;
}

type Phase = { kind: "intro" } | { kind: "question"; index: number } | { kind: "gate"; resultKey: string } | { kind: "result"; resultKey: string };

export default function Player(p: Props) {
  const { content, settings } = p;
  const [phase, setPhase] = useState<Phase>(p.initialResult ? { kind: "result", resultKey: p.initialResult } : { kind: "intro" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [leadDone, setLeadDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const viewed = useRef(false);
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

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 1800);
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
    if (settings.lead.enabled && settings.lead.placement === "before_result") setPhase({ kind: "gate", resultKey });
    else setPhase({ kind: "result", resultKey });
    window.scrollTo({ top: 0 });
  }

  const style = { ["--t-accent" as string]: accent } as React.CSSProperties;
  const themeClass = settings.theme.style === "night" ? "theme-night" : settings.theme.style === "calm" ? "theme-calm" : "";

  return (
    <div className={`player ${themeClass}`} style={{ ...style, background: settings.theme.style === "night" ? "#12131f" : undefined }}>
      <div className="narrow" style={{ maxWidth: 560 }}>
        {p.preview ? <div className="notice" style={{ marginBottom: 12 }}>미리보기예요. 참여 기록은 집계되지 않아요.</div> : null}
        <div className="player-card">
          {phase.kind === "intro" ? (
            <div className="stack center">
              {settings.brandName ? <span className="pill" style={{ justifySelf: "center", background: `${accent}22`, color: accent }}>{settings.brandName}</span> : null}
              <h1 className="q-text" style={{ fontSize: "clamp(28px, 7vw, 38px)" }}>{content.title}</h1>
              {content.subtitle ? <p className="muted">{content.subtitle}</p> : null}
              {content.intro ? <p className="small muted">{content.intro}</p> : null}
              <div className="row" style={{ justifyContent: "center" }}>
                {content.results.slice(0, 8).map((r) => <span key={r.key} style={{ fontSize: 28 }} aria-hidden="true">{r.emoji}</span>)}
              </div>
              <button type="button" className="btn btn-primary btn-block" style={{ background: accent }} onClick={() => { track("start"); setPhase({ kind: "question", index: 0 }); }}>
                시작하기
              </button>
              <p className="tiny muted">{content.questions.length}문항 · 약 {Math.max(1, Math.round(content.questions.length * 0.15))}분</p>
            </div>
          ) : null}

          {phase.kind === "question" ? (() => {
            const q = content.questions[phase.index];
            if (!q) return null;
            return (
              <div className="stack">
                <div className="row between small muted"><span className="num">{phase.index + 1} / {content.questions.length}</span>
                  {phase.index > 0 ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase({ kind: "question", index: phase.index - 1 })}>이전</button> : <span />}
                </div>
                <div className="progress" aria-hidden="true"><i style={{ width: `${((phase.index + 1) / content.questions.length) * 100}%` }} /></div>
                <h2 className="q-text">{q.text}</h2>
                <div className="stack" style={{ gap: 10 }}>
                  {q.options.map((o) => (
                    <button key={o.id} type="button" className="option" onClick={() => choose(q.id, o.id, phase.index)}
                      style={answers[q.id] === o.id ? { borderColor: accent } : undefined}>{o.text}</button>
                  ))}
                </div>
              </div>
            );
          })() : null}

          {phase.kind === "gate" ? (
            <div className="stack">
              <h2 className="q-text center">결과가 준비됐어요!</h2>
              <p className="center muted small">아래 정보를 남기면 바로 결과를 보여 드려요.</p>
              <LeadForm slug={p.slug} settings={settings} resultKey={phase.resultKey} preview={p.preview} onDone={() => { setLeadDone(true); setPhase({ kind: "result", resultKey: phase.resultKey }); }} />
            </div>
          ) : null}

          {phase.kind === "result" ? (
            <ResultView
              {...p}
              resultKey={phase.resultKey}
              leadDone={leadDone}
              onLeadDone={() => setLeadDone(true)}
              onRetry={() => { setAnswers({}); setLeadDone(false); setPhase({ kind: "intro" }); window.scrollTo({ top: 0 }); }}
              track={track}
              flash={flash}
            />
          ) : null}
        </div>
        {toast ? <div role="status" style={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)", background: "#15172b", color: "#fff", padding: "10px 16px", borderRadius: 999, fontSize: 14 }}>{toast}</div> : null}
      </div>
    </div>
  );
}

function ResultView(p: Props & { resultKey: string; leadDone: boolean; onLeadDone: () => void; onRetry: () => void; track: (t: string, e?: { resultKey?: string; channel?: string }) => void; flash: (t: string) => void }) {
  const { content, settings } = p;
  const result = content.results.find((r) => r.key === p.resultKey) ?? content.results[0];
  const match = useMemo(() => content.results.find((r) => r.key === result?.bestMatch), [content.results, result]);
  if (!result) return null;
  const resultUrl = `${p.publicUrl}/r/${result.key}`;
  const shareText = `나는 「${result.name}」! ${content.title} 해 보기`;
  const couponCode = settings.coupon.perResult[result.key] || settings.coupon.code;
  const couponLocked = settings.coupon.requireLead && settings.lead.enabled && !p.leadDone;

  async function share(channel: "kakao" | "native" | "copy") {
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

  return (
    <div className="stack">
      <div className="result-hero" style={{ background: result.color }}>
        <span className="small" style={{ opacity: 0.9 }}>나의 결과는</span>
        {result.emoji ? <span className="emoji" aria-hidden="true">{result.emoji}</span> : null}
        <h2>{result.name}</h2>
        {result.tagline ? <p style={{ fontWeight: 600 }}>{result.tagline}</p> : null}
        {result.traits.length ? <div className="traits">{result.traits.map((t) => <span key={t}>#{t}</span>)}</div> : null}
      </div>
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
          <button type="button" className="btn btn-dark" style={{ flex: 1 }} onClick={() => share("native")}>결과 공유하기</button>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => share("copy")}>링크 복사</button>
        </div>
        <a className="btn btn-ghost btn-block" href={`/api/og?slug=${p.slug}&key=${result.key}`} target="_blank" rel="noreferrer" onClick={() => p.track("share", { resultKey: result.key, channel: "image" })}>결과 이미지 저장 (인스타 스토리용)</a>
      </div>

      {settings.lead.enabled && settings.lead.placement === "after_result" && !p.leadDone ? (
        <div className="card stack">
          <b>{settings.lead.headline}</b>
          <LeadForm slug={p.slug} settings={settings} resultKey={result.key} preview={p.preview} onDone={p.onLeadDone} />
        </div>
      ) : null}
      {p.leadDone ? <p className="small center">고마워요! 남겨 주신 정보로 안내드릴게요.</p> : null}

      {settings.coupon.enabled && couponCode ? (
        <div className="coupon">
          <b>{settings.coupon.title}</b>
          {couponLocked ? <span className="small muted">위에 연락처를 남기면 쿠폰 코드가 열려요.</span> : (
            <>
              <code onClick={() => p.track("coupon_reveal", { resultKey: result.key })}>{couponCode}</code>
              {settings.coupon.note ? <span className="tiny muted">{settings.coupon.note}</span> : null}
            </>
          )}
        </div>
      ) : null}

      {settings.cta.enabled && settings.cta.url ? (
        <a className="btn btn-primary btn-block" style={{ background: settings.theme.accent }} href={settings.cta.url} target="_blank" rel="noopener" onClick={() => p.track("cta_click", { resultKey: result.key })}>{settings.cta.label}</a>
      ) : null}

      <details className="card card-tight">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>다른 유형도 보기</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          {content.results.map((r) => (
            <div key={r.key} className="row small"><span aria-hidden="true">{r.emoji}</span><b style={{ color: r.color }}>{r.name}</b><span className="muted">{r.tagline}</span></div>
          ))}
        </div>
      </details>

      <button type="button" className="btn btn-ghost btn-block" onClick={p.onRetry}>다시 하기</button>

      {p.watermark ? (
        <a className="watermark" href={`/create?ref=${p.slug}`} onClick={() => p.track("watermark_click")}>
          {p.isHouse ? "우리 브랜드 테스트도 만들 수 있어요 · " : `${p.brandName}에서 만든 테스트예요 · `}<b>나도 만들기 →</b>
        </a>
      ) : null}
      <p className="tiny muted center">이 테스트는 재미를 위한 콘텐츠이며 AI가 생성한 문구를 포함할 수 있어요.</p>
    </div>
  );
}
