import type { TestContent } from "./schema";

/** answers: questionId -> optionId. Returns the winning result key (ties go to the earlier result). */
export function computeResult(content: TestContent, answers: Record<string, string>): string {
  const totals = new Map<string, number>(content.results.map((r) => [r.key, 0]));
  for (const q of content.questions) {
    const chosen = q.options.find((o) => o.id === answers[q.id]);
    if (!chosen) continue;
    for (const w of chosen.weights) {
      totals.set(w.key, (totals.get(w.key) ?? 0) + w.points);
    }
  }
  let best = content.results[0]?.key ?? "";
  let bestScore = -1;
  for (const r of content.results) {
    const s = totals.get(r.key) ?? 0;
    if (s > bestScore) {
      best = r.key;
      bestScore = s;
    }
  }
  return best;
}

/** How many option paths lead to each result; used to warn about lopsided tests in the editor. */
export function resultReach(content: TestContent): Record<string, number> {
  const reach: Record<string, number> = Object.fromEntries(content.results.map((r) => [r.key, 0]));
  for (const q of content.questions) {
    for (const o of q.options) {
      for (const w of o.weights) {
        reach[w.key] = (reach[w.key] ?? 0) + w.points;
      }
    }
  }
  return reach;
}
