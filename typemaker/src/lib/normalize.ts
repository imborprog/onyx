import type { TestContent } from "./schema";

// Repairs near-valid model output so a slightly-off response still becomes a
// playable test: clamps lengths and points, fixes keys and ids, and makes sure
// every result is reachable. The caller validates the result with zod after.

const PALETTE = ["#ff5a36", "#2f6fed", "#f2a900", "#2e9e6b", "#8a5cf6", "#e8467c", "#3a3f58", "#c46a2b", "#0e9aa7", "#b5179e", "#6a994e", "#f77f00"];

function str(v: unknown, max: number, fallback = ""): string {
  const s = typeof v === "string" ? v.trim() : fallback;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function normalizeContent(raw: unknown, wantResults?: number): TestContent {
  const r = obj(raw);
  const rawResults = arr(r.results).map(obj).slice(0, wantResults ?? 12);

  // Map whatever keys the model used to clean, unique r1..rn keys.
  const keyMap = new Map<string, string>();
  const results = rawResults.map((res, i) => {
    const clean = `r${i + 1}`;
    const original = typeof res.key === "string" ? res.key : clean;
    keyMap.set(original, clean);
    keyMap.set(clean, clean);
    const color = typeof res.color === "string" && /^#[0-9a-fA-F]{6}$/.test(res.color) ? res.color : (PALETTE[i % PALETTE.length] as string);
    return {
      key: clean,
      name: str(res.name, 40, `유형 ${i + 1}`) || `유형 ${i + 1}`,
      emoji: str(res.emoji, 8),
      tagline: str(res.tagline, 100),
      description: str(res.description, 900),
      traits: arr(res.traits).map((t) => str(t, 40)).filter(Boolean).slice(0, 6),
      bestMatch: typeof res.bestMatch === "string" ? res.bestMatch : null,
      color,
    };
  });
  const keys = results.map((x) => x.key);
  for (const res of results) {
    res.bestMatch = res.bestMatch ? (keyMap.get(res.bestMatch) ?? null) : null;
    if (res.bestMatch === res.key) res.bestMatch = null;
  }

  let rr = 0;
  const nextKey = () => keys[rr++ % Math.max(keys.length, 1)] as string;

  const questions = arr(r.questions)
    .map(obj)
    .slice(0, 15)
    .map((q, qi) => {
      const options = arr(q.options)
        .map(obj)
        .slice(0, 4)
        .map((o, oi) => {
          const weights = arr(o.weights)
            .map(obj)
            .map((w) => ({
              key: keyMap.get(String(w.key)) ?? "",
              points: Math.min(3, Math.max(1, Math.round(Number(w.points) || 1))),
            }))
            .filter((w) => w.key !== "")
            .slice(0, 3);
          return {
            id: String.fromCharCode(97 + oi),
            text: str(o.text, 100, "") || `보기 ${oi + 1}`,
            weights: weights.length ? weights : [{ key: nextKey(), points: 2 }],
          };
        });
      return { id: `q${qi + 1}`, text: str(q.text, 140, "") || `질문 ${qi + 1}`, options };
    })
    .filter((q) => q.options.length >= 2);

  // Every result must be reachable from at least one option.
  const used = new Set(questions.flatMap((q) => q.options.flatMap((o) => o.weights.map((w) => w.key))));
  const missing = keys.filter((k) => !used.has(k));
  let slot = 0;
  for (const k of missing) {
    const q = questions[slot % Math.max(questions.length, 1)];
    slot++;
    if (!q) break;
    const o = q.options[slot % q.options.length];
    if (o && o.weights.length < 3) o.weights.push({ key: k, points: 2 });
    else if (o) o.weights[o.weights.length - 1] = { key: k, points: 2 };
  }

  return {
    title: str(r.title, 60, "나의 유형 테스트") || "나의 유형 테스트",
    subtitle: str(r.subtitle, 120),
    intro: str(r.intro, 400),
    questions,
    results,
  };
}
