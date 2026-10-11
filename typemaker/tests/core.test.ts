import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BriefSchema, parseSettings, TestContentSchema } from "@/lib/schema";
import { computeResult, resultReach } from "@/lib/scoring";
import { josa, templateTest } from "@/lib/templates";
import { normalizeContent } from "@/lib/normalize";
import { matchFaq } from "@/lib/faq";

const houseDir = path.join(__dirname, "..", "ops", "house-tests");

describe("josa", () => {
  it("picks the particle from the final consonant", () => {
    expect(josa("커피", "을/를")).toBe("커피를");
    expect(josa("공부 습관", "을/를")).toBe("공부 습관을");
    expect(josa("여행", "이/가")).toBe("여행이");
    expect(josa("카페", "은/는")).toBe("카페는");
  });
});

describe("templateTest", () => {
  for (const resultCount of [4, 6, 8] as const) {
    it(`builds a valid, fully reachable test with ${resultCount} results`, () => {
      const brief = BriefSchema.parse({ topic: "커피 취향", resultCount, questionCount: 8 });
      const content = TestContentSchema.parse(templateTest(brief));
      expect(content.results).toHaveLength(resultCount);
      expect(content.questions).toHaveLength(8);
      const reach = resultReach(content);
      for (const r of content.results) expect(reach[r.key]).toBeGreaterThan(0);
    });
  }

  it("lets every result win for some answer path", () => {
    const content = templateTest(BriefSchema.parse({ topic: "운동", resultCount: 4 }));
    const winners = new Set<string>();
    for (let oi = 0; oi < 4; oi++) {
      const answers = Object.fromEntries(content.questions.map((q) => [q.id, q.options[oi]?.id ?? "a"]));
      winners.add(computeResult(content, answers));
    }
    expect(winners.size).toBe(4);
  });
});

describe("computeResult", () => {
  const content = TestContentSchema.parse({
    title: "t",
    questions: [1, 2, 3].map((i) => ({
      id: `q${i}`,
      text: "q",
      options: [
        { id: "a", text: "a", weights: [{ key: "r1", points: 2 }] },
        { id: "b", text: "b", weights: [{ key: "r2", points: 2 }] },
      ],
    })),
    results: [
      { key: "r1", name: "A" },
      { key: "r2", name: "B" },
    ],
  });

  it("returns the highest scoring result", () => {
    expect(computeResult(content, { q1: "b", q2: "b", q3: "a" })).toBe("r2");
  });

  it("breaks ties toward the earlier result and ignores unknown answers", () => {
    expect(computeResult(content, { q1: "a", q2: "b", q3: "zz" })).toBe("r1");
  });
});

describe("normalizeContent", () => {
  it("repairs sloppy model output into a valid test", () => {
    const raw = {
      title: "x".repeat(80),
      results: [
        { key: "Fox Type", name: "여우", color: "red", traits: ["a"] },
        { key: "bear", name: "곰", bestMatch: "Fox Type" },
        { key: "owl", name: "부엉이" },
      ],
      questions: [
        { text: "q1", options: [{ text: "a", weights: [{ key: "Fox Type", points: 9 }] }, { text: "b", weights: [{ key: "nope", points: 1 }] }] },
        { text: "q2", options: [{ text: "a", weights: [] }, { text: "b", weights: [{ key: "bear", points: 0 }] }] },
        { text: "q3", options: [{ text: "a" }, { text: "b" }] },
      ],
    };
    const c = TestContentSchema.parse(normalizeContent(raw, 3));
    expect(c.title.length).toBeLessThanOrEqual(60);
    expect(c.results.map((r) => r.key)).toEqual(["r1", "r2", "r3"]);
    expect(c.results[1]?.bestMatch).toBe("r1");
    expect(c.results[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
    const reach = resultReach(c);
    for (const r of c.results) expect(reach[r.key]).toBeGreaterThan(0);
  });
});

describe("settings", () => {
  it("fills defaults for partial settings", () => {
    const s = parseSettings({ lead: { enabled: true } });
    expect(s.lead.enabled).toBe(true);
    expect(s.lead.fields).toEqual(["name", "phone"]);
    expect(s.coupon.enabled).toBe(false);
    expect(s.theme.accent).toBe("#ff5a36");
  });
});

describe("house tests", () => {
  for (const f of readdirSync(houseDir).filter((x) => x.endsWith(".json"))) {
    it(`${f} is valid and balanced`, () => {
      const c = TestContentSchema.parse(JSON.parse(readFileSync(path.join(houseDir, f), "utf8")));
      const values = Object.values(resultReach(c));
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2);
    });
  }
});

describe("faq", () => {
  it("matches refund questions to the refund answer", () => {
    expect(matchFaq("환불 받을 수 있나요?")[0]?.q).toContain("환불");
  });
});
