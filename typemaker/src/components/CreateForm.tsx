"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getSavedWorkspace, saveWorkspace } from "@/lib/client";
import type { Brief } from "@/lib/schema";

type Goal = Brief["goal"];
type Tone = Brief["tone"];

const GOALS: { v: Goal; label: string; hint: string }[] = [
  { v: "fun", label: "재미·공유", hint: "많이 퍼지는 게 목표" },
  { v: "leads", label: "상담 신청 모으기", hint: "결과 화면에 연락처 폼" },
  { v: "coupon", label: "쿠폰 주기", hint: "결과별 할인 코드" },
  { v: "education", label: "정보 전달", hint: "브랜드·제품 알리기" },
];
const TONES: { v: Tone; label: string }[] = [
  { v: "playful", label: "발랄하게" },
  { v: "witty", label: "위트 있게" },
  { v: "warm", label: "따뜻하게" },
  { v: "calm", label: "차분하게" },
];
const EXAMPLES = ["우리 카페 커피 취향", "신학기 공부 습관", "여름휴가 여행 스타일", "운동 루틴 성향", "연애할 때 나의 모습"];
const WAIT_MESSAGES = ["질문을 고르는 중…", "보기마다 점수를 배분하는 중…", "결과 유형 이름을 짓는 중…", "결과 설명을 다듬는 중…", "공유 이미지를 준비하는 중…"];

export default function CreateForm({ aiEnabled }: { aiEnabled: boolean }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [brandName, setBrandName] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState<Goal>("fun");
  const [resultCount, setResultCount] = useState<4 | 6 | 8>(4);
  const [questionCount, setQuestionCount] = useState(8);
  const [tone, setTone] = useState<Tone>("playful");
  const [extra, setExtra] = useState("");
  const [email, setEmail] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [concierge, setConcierge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitIdx, setWaitIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setWaitIdx((i) => (i + 1) % WAIT_MESSAGES.length), 4000);
    return () => window.clearInterval(t);
  }, [busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (topic.trim().length < 2) {
      setError("주제를 두 글자 이상 적어 주세요.");
      return;
    }
    if (concierge && !email.trim()) {
      setError("운영팀 제작 요청은 완성 알림을 받을 이메일이 필요해요.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ mode: "ready" | "queued"; workspaceSecret: string; testId?: string; notice?: string | null }>("/api/tests", {
        workspace: getSavedWorkspace(),
        body: {
          brief: { topic, brandName, audience, goal, resultCount, questionCount, tone, extra },
          email,
          marketingOptIn,
          mode: concierge ? "concierge" : "instant",
        },
      });
      saveWorkspace(res.workspaceSecret);
      if (res.mode === "queued") router.push(`/w/${res.workspaceSecret}?queued=1`);
      else router.push(`/w/${res.workspaceSecret}/t/${res.testId}${res.notice ? "?notice=fallback" : "?new=1"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="card stack center" style={{ paddingBlock: 48 }} aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <b>{concierge ? "제작 요청을 접수하는 중…" : WAIT_MESSAGES[waitIdx]}</b>
        {aiEnabled && !concierge ? <p className="muted small">AI가 초안을 쓰는 데 30초~1분쯤 걸려요. 창을 닫지 말아 주세요.</p> : null}
      </div>
    );
  }

  return (
    <form className="stack-lg" onSubmit={submit}>
      <div className="field">
        <label htmlFor="topic">테스트 주제 *</label>
        <input id="topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예) 우리 카페 커피 취향" maxLength={80} required />
        <div className="row tiny">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="pill gray" style={{ border: 0, cursor: "pointer" }} onClick={() => setTopic(ex)}>{ex}</button>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="brand">브랜드 이름</label>
          <input id="brand" className="input" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="예) 오늘의커피" maxLength={40} />
        </div>
        <div className="field">
          <label htmlFor="aud">누가 할 테스트인가요?</label>
          <input id="aud" className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="예) 20대 대학생" maxLength={80} />
        </div>
      </div>

      <div className="field">
        <span className="label">목적</span>
        <div className="segmented" role="group" aria-label="목적">
          {GOALS.map((g) => (
            <button key={g.v} type="button" aria-pressed={goal === g.v} onClick={() => setGoal(g.v)} title={g.hint}>{g.label}</button>
          ))}
        </div>
        <span className="hint">{GOALS.find((g) => g.v === goal)?.hint}</span>
      </div>

      <div className="grid-2">
        <div className="field">
          <span className="label">결과 유형 수</span>
          <div className="segmented" role="group" aria-label="결과 유형 수">
            {([4, 6, 8] as const).map((n) => (
              <button key={n} type="button" aria-pressed={resultCount === n} onClick={() => setResultCount(n)}>{n}가지</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">질문 수</span>
          <div className="segmented" role="group" aria-label="질문 수">
            {[6, 8, 10].map((n) => (
              <button key={n} type="button" aria-pressed={questionCount === n} onClick={() => setQuestionCount(n)}>{n}개</button>
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <span className="label">말투</span>
        <div className="segmented" role="group" aria-label="말투">
          {TONES.map((t) => (
            <button key={t.v} type="button" aria-pressed={tone === t.v} onClick={() => setTone(t.v)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="extra">추가로 바라는 점</label>
        <textarea id="extra" className="textarea" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="예) 결과마다 어울리는 메뉴를 추천해 주세요" maxLength={500} />
      </div>

      <div className="card stack">
        <div className="field">
          <label htmlFor="email">이메일 (선택)</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="관리 링크와 완성 알림을 보내 드려요" maxLength={120} />
        </div>
        <label className="check">
          <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
          <span>(선택) 새 기능·할인 소식을 이메일로 받을게요. 언제든 수신거부할 수 있어요.</span>
        </label>
        {!aiEnabled ? (
          <label className="check">
            <input type="checkbox" checked={concierge} onChange={(e) => setConcierge(e.target.checked)} />
            <span>운영팀이 직접 기획한 초안 받기 (24시간 이내, 위 이메일로 알려 드려요). 끄면 기본 초안이 바로 만들어져요.</span>
          </label>
        ) : null}
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary btn-block">{concierge ? "제작 요청하기" : "초안 만들기"}</button>
      <p className="tiny muted center">만들기를 누르면 <a href="/legal/terms">이용약관</a>과 <a href="/legal/privacy">개인정보처리방침</a>에 동의하는 것으로 봅니다.</p>
    </form>
  );
}
