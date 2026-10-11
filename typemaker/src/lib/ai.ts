import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./config";
import { GOAL_LABEL, TONE_LABEL, TestContentSchema, type Brief, type TestContent } from "./schema";
import { normalizeContent } from "./normalize";

const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: ENV.anthropicKey(), timeout: 150_000, maxRetries: 1 });
  return client;
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "intro", "results", "questions"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    intro: { type: "string" },
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "name", "emoji", "tagline", "description", "traits", "bestMatch", "color"],
        properties: {
          key: { type: "string" },
          name: { type: "string" },
          emoji: { type: "string" },
          tagline: { type: "string" },
          description: { type: "string" },
          traits: { type: "array", items: { type: "string" } },
          bestMatch: { anyOf: [{ type: "string" }, { type: "null" }] },
          color: { type: "string" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "options"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "text", "weights"],
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                weights: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["key", "points"],
                    properties: { key: { type: "string" }, points: { type: "integer" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `당신은 한국 SNS에서 공유가 잘 되는 심리테스트(성향·유형 테스트)를 기획하는 카피라이터입니다.
브리프를 받아 바로 발행할 수 있는 테스트 한 편을 JSON으로 만듭니다.

좋은 테스트의 조건:
- 제목은 클릭하고 싶게 짧게 (예: "나의 ○○ 유형은?", "○○할 때 드러나는 나의 본캐는?"). 60자 이내.
- 질문은 구체적인 상황형으로 쓴다 ("~할 때 나는?"). 누구나 바로 떠올릴 수 있는 일상 장면을 고른다.
- 보기는 짧고 말맛 있게, 서로 확실히 구분되게. 질문마다 3~4개.
- 결과 이름은 공유하고 싶은 별명형 ("○○형", "○○러"). 모든 결과가 매력적이어야 하고 누구도 기분 나쁘지 않게 쓴다.
- tagline은 한 줄 요약, description은 3~4문장으로 "맞아 이거 나야" 싶은 디테일을 담는다. traits는 짧은 키워드 3개.
- bestMatch에는 잘 맞는 다른 결과의 key를 넣는다.
- color는 결과마다 다른 #RRGGBB 색.
- 결과 key는 r1, r2, ... 형식. 질문 id는 q1, q2, ..., 보기 id는 a, b, c, d.
- 각 보기의 weights는 결과 1~2개에 points 1~3을 준다. 모든 결과가 비슷한 빈도로 나오도록 균형을 맞추고, 어떤 결과도 빠지지 않게 한다.
- 브랜드가 주어지면 테스트와 결과 설명에 자연스럽게 녹이되 광고처럼 보이지 않게 한다.

절대 하지 않는 것:
- 의학적·심리학적 진단처럼 보이는 표현 (우울, 불안, 장애, 치료 등)
- "MBTI" 등 타사 상표 명칭
- 건강, 정치, 종교, 성적 지향 같은 민감한 정보를 묻는 질문
- 혐오, 차별, 선정적 표현, 특정 집단 비하

반드시 지정된 JSON 스키마로만 답한다.`;

function briefPrompt(b: Brief): string {
  return [
    `주제: ${b.topic}`,
    b.brandName ? `브랜드: ${b.brandName}` : "브랜드: 없음",
    b.audience ? `대상: ${b.audience}` : "대상: 일반 2030",
    `목적: ${GOAL_LABEL[b.goal]}`,
    `말투: ${TONE_LABEL[b.tone]}`,
    `결과 개수: ${b.resultCount}개`,
    `질문 개수: ${b.questionCount}개`,
    b.extra ? `추가 요청: ${b.extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class AiRefusalError extends Error {}

export async function generateTestWithAi(brief: Brief): Promise<TestContent> {
  const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: briefPrompt(brief) }],
  };

  const msg = await anthropic().beta.messages.create(params);
  if (msg.stop_reason === "refusal") throw new AiRefusalError("요청하신 주제로는 테스트를 만들 수 없어요. 주제를 바꿔 주세요.");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (!text) throw new Error("AI 응답이 비어 있습니다");
  const raw: unknown = JSON.parse(text);
  const content = normalizeContent(raw, brief.resultCount);
  return TestContentSchema.parse(content);
}

export async function answerSupportQuestion(question: string, faq: string): Promise<string | null> {
  const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: `당신은 "${process.env.NEXT_PUBLIC_BRAND_NAME ?? "유형공장"}" 고객지원 담당입니다. 아래 FAQ에 있는 사실만으로 한국어 존댓말 3~5문장으로 답하세요.
FAQ로 답할 수 없거나 환불·결제 취소·개인정보 삭제·법적 문의라면 추측하지 말고 "담당자가 확인 후 답변드리겠습니다"라고만 안내하세요.
환불이나 보상을 약속하지 마세요.

FAQ:
${faq}`,
    messages: [{ role: "user", content: question }],
  };
  const msg = await anthropic().beta.messages.create(params);
  if (msg.stop_reason === "refusal") return null;
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  return text || null;
}
