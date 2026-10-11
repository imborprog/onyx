import type { Brief, TestContent } from "./schema";

// Rule-based generator used when no ANTHROPIC_API_KEY is configured, and as a
// last-resort fallback when the AI response cannot be repaired. Output is
// always a valid, balanced test that the creator can then edit.

type Pair = "을/를" | "이/가" | "은/는" | "과/와" | "이란/란" | "이라도/라도";

export function josa(word: string, pair: Pair): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const hasBatchim = isHangul ? (code - 0xac00) % 28 !== 0 : /[0-9a-zA-Z]$/.test(last) && /[lmnr136780]$/i.test(last);
  const [withB, withoutB] = pair.split("/") as [string, string];
  return word + (hasBatchim ? withB : withoutB);
}

interface Archetype {
  key: string;
  name: string;
  emoji: string;
  color: string;
  tagline: (t: string) => string;
  description: (t: string) => string;
  traits: string[];
  bestMatch: string;
}

const ARCHETYPES: Archetype[] = [
  {
    key: "spark", name: "즉흥 탐험가", emoji: "⚡", color: "#ff5a36", bestMatch: "planner",
    tagline: (t) => `${josa(t, "은/는")} 일단 해 보고 생각하는 편!`,
    description: (t) => `새로운 ${josa(t, "을/를")} 누구보다 먼저 시도하는 행동파예요. 고민보다 경험을 믿고, 그 과정에서 생기는 우연을 즐깁니다. 가끔은 계획 없이 움직이다 길을 잃기도 하지만 그 덕분에 남들이 모르는 재미를 발견하죠.`,
    traits: ["행동력", "호기심", "도전정신"],
  },
  {
    key: "planner", name: "꼼꼼 설계자", emoji: "📐", color: "#2f6fed", bestMatch: "spark",
    tagline: (t) => `${t}도 계획이 있어야 마음이 편해요`,
    description: (t) => `${josa(t, "을/를")} 시작하기 전에 비교하고 정리하는 전략가예요. 실패 확률을 줄이는 법을 알고, 한 번 정한 목표는 끝까지 챙깁니다. 주변 사람들은 결정을 앞두고 당신의 정리를 기다려요.`,
    traits: ["분석력", "계획성", "신중함"],
  },
  {
    key: "mood", name: "분위기 메이커", emoji: "🎉", color: "#f2a900", bestMatch: "artisan",
    tagline: (t) => `${josa(t, "은/는")} 함께할 때 두 배로 즐거워요`,
    description: (t) => `${t}의 진짜 재미는 사람에게서 나온다고 믿는 타입이에요. 처음 보는 사람과도 금방 친해지고, 모임의 에너지를 끌어올립니다. 당신이 있는 자리엔 늘 웃음이 따라와요.`,
    traits: ["친화력", "공감", "에너지"],
  },
  {
    key: "artisan", name: "집요한 장인", emoji: "🛠️", color: "#3a3f58", bestMatch: "mood",
    tagline: (t) => `${t}, 한 번 빠지면 끝까지 파요`,
    description: (t) => `${josa(t, "을/를")} 깊게 이해하고 싶은 몰입형이에요. 남들이 지나치는 디테일에서 차이를 만들고, 오래 쌓은 경험이 실력이 됩니다. 조용하지만 결정적인 순간에 가장 믿음직한 사람이에요.`,
    traits: ["몰입", "전문성", "꾸준함"],
  },
  {
    key: "healer", name: "다정한 힐러", emoji: "🌿", color: "#2e9e6b", bestMatch: "trend",
    tagline: (t) => `편안한 ${josa(t, "이/가")} 최고라고 생각해요`,
    description: (t) => `${t}에서도 나와 주변 사람의 마음이 편한 게 먼저인 배려형이에요. 무리하지 않고 자기 속도를 지키며, 지친 사람에게 쉼표가 되어 줍니다.`,
    traits: ["배려", "안정감", "여유"],
  },
  {
    key: "value", name: "실속 마스터", emoji: "💡", color: "#8a5cf6", bestMatch: "story",
    tagline: (t) => `${t}도 똑똑하게, 가성비 있게`,
    description: (t) => `같은 ${josa(t, "이라도/라도")} 더 알차게 즐기는 방법을 아는 실속파예요. 정보력이 좋아서 주변의 꿀팁 창구 역할을 하고, 후회 없는 선택을 잘합니다.`,
    traits: ["정보력", "합리성", "알뜰함"],
  },
  {
    key: "trend", name: "트렌드 헌터", emoji: "🔥", color: "#e8467c", bestMatch: "healer",
    tagline: (t) => `요즘 뜨는 ${t}? 내가 제일 먼저 알아요`,
    description: (t) => `${t}의 새로운 흐름을 가장 빨리 포착하는 감각파예요. 유행을 따라가기보다 먼저 경험하고 알리는 쪽에 가깝고, 당신의 피드는 늘 새로워요.`,
    traits: ["감각", "속도", "표현력"],
  },
  {
    key: "story", name: "감성 수집가", emoji: "📷", color: "#c46a2b", bestMatch: "value",
    tagline: (t) => `${t}에 의미와 추억을 담아요`,
    description: (t) => `${t}에서도 이야기와 의미를 찾는 감성형이에요. 작은 순간을 기록하고 오래 간직하며, 당신이 남긴 기록은 시간이 지날수록 빛납니다.`,
    traits: ["감수성", "기록", "취향"],
  },
];

const RESULT_SETS: Record<4 | 6 | 8, string[]> = {
  4: ["spark", "planner", "mood", "artisan"],
  6: ["spark", "planner", "mood", "artisan", "healer", "value"],
  8: ["spark", "planner", "mood", "artisan", "healer", "value", "trend", "story"],
};

// Option groups: A (spark/trend), B (planner/value), C (mood/healer), D (artisan/story)
const GROUPS: [string, string][] = [
  ["spark", "trend"],
  ["planner", "value"],
  ["mood", "healer"],
  ["artisan", "story"],
];

const QUESTION_BANK: { text: (t: string) => string; options: [string, string, string, string] }[] = [
  { text: (t) => `${josa(t, "을/를")} 처음 접할 때 나는?`, options: ["일단 해 보고 생각한다", "후기부터 꼼꼼히 찾아본다", "친구랑 같이 해 본다", "원리부터 깊게 알아본다"] },
  { text: (t) => `주말에 ${t} 관련 일정이 생기면?`, options: ["즉흥으로 새로운 곳에 간다", "동선과 예산을 미리 짠다", "사람 많은 곳이 좋다", "혼자 집중할 시간을 만든다"] },
  { text: (t) => `${t}에서 가장 중요한 건?`, options: ["새로움과 설렘", "효율과 실속", "함께하는 즐거움", "완성도와 디테일"] },
  { text: (t) => `친구가 ${t} 추천을 부탁하면?`, options: ["요즘 뜨는 걸 바로 알려준다", "비교표를 만들어 준다", "같이 가자고 한다", "내가 아끼는 숨은 보석을 알려준다"] },
  { text: (t) => `${t} 때문에 지칠 때 나는?`, options: ["기분 전환으로 새로운 걸 시도한다", "원인을 정리해서 해결한다", "누군가에게 털어놓는다", "혼자 묵묵히 파고든다"] },
  { text: (t) => `SNS에 ${t} 사진을 올린다면?`, options: ["지금 이 순간 바로 업로드", "보정까지 계획적으로", "친구 태그 잔뜩", "의미를 담은 긴 글과 함께"] },
  { text: (t) => `${t}에 쓸 예산이 생기면?`, options: ["안 해 본 걸 경험한다", "가성비 최고를 고른다", "모두가 즐길 수 있는 데 쓴다", "오래 쓸 좋은 것 하나를 산다"] },
  { text: (t) => `${josa(t, "을/를")} 오래 즐기는 비결은?`, options: ["계속 새로운 자극", "꾸준한 루틴", "함께하는 사람", "나만의 확실한 기준"] },
  { text: (t) => `${t} 모임에서 나는?`, options: ["아이디어 뱅크", "일정·정리 담당", "분위기 메이커", "조용한 전문가"] },
  { text: (t) => `${t}에서 실패했을 때 나는?`, options: ["다음엔 다른 방법으로!", "기록하고 원인을 분석한다", "같이 웃어넘긴다", "될 때까지 다시 한다"] },
  { text: (t) => `${t} 관련 새 소식을 들으면?`, options: ["바로 해 본다", "검증될 때까지 지켜본다", "단톡방에 공유한다", "깊이 있는 자료를 찾아본다"] },
  { text: (t) => `나에게 ${josa(t, "이란/란")}?`, options: ["설렘", "계획", "추억", "자부심"] },
];

export function templateTest(brief: Brief): TestContent {
  const topic = brief.topic.trim();
  const keys = RESULT_SETS[brief.resultCount];
  const keySet = new Set(keys);
  const qCount = Math.min(Math.max(brief.questionCount, 5), QUESTION_BANK.length);

  const questions = QUESTION_BANK.slice(0, qCount).map((q, qi) => ({
    id: `q${qi + 1}`,
    text: q.text(topic),
    options: q.options.map((text, oi) => {
      const [first, second] = GROUPS[oi] as [string, string];
      // Alternate which archetype in a group is primary so every result can win.
      const [primary, secondary] = qi % 2 === 0 ? [first, second] : [second, first];
      const weights: { key: string; points: number }[] = [];
      if (keySet.has(primary)) weights.push({ key: primary, points: 2 });
      if (keySet.has(secondary)) weights.push({ key: secondary, points: keySet.has(primary) ? 1 : 2 });
      if (weights.length === 0) weights.push({ key: first, points: 1 });
      return { id: String.fromCharCode(97 + oi), text, weights };
    }),
  }));

  const results = keys.map((k) => {
    const a = ARCHETYPES.find((x) => x.key === k) as Archetype;
    return {
      key: a.key,
      name: a.name,
      emoji: a.emoji,
      tagline: a.tagline(topic),
      description: a.description(topic),
      traits: a.traits,
      bestMatch: keySet.has(a.bestMatch) ? a.bestMatch : null,
      color: a.color,
    };
  });

  const brand = brief.brandName ? `${josa(brief.brandName, "과/와")} 함께하는 ` : "";
  return {
    title: `나의 ${topic} 유형 테스트`.slice(0, 60),
    subtitle: `${brand}${qCount}개 질문으로 알아보는 나의 ${topic} 스타일`.slice(0, 120),
    intro: `가볍게 답해 보세요. 정답은 없어요. 결과를 친구와 비교해 보면 더 재밌어요!`,
    questions,
    results,
  };
}
