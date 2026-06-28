/**
 * Reciprocal Rank Fusion + per-document dedup. NODE-ONLY, PURE.
 */

export interface RankedItem {
  chunkId: string;
}

export interface FusedItem {
  chunkId: string;
  score: number;
}

/**
 * Combine several ranked lists. RRF score = Σ 1/(k + rank). Higher is better.
 * `k` damps the contribution of low ranks (default 60, common choice).
 */
export function reciprocalRankFusion(
  lists: ReadonlyArray<ReadonlyArray<RankedItem>>,
  k = 60,
): FusedItem[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      scores.set(item.chunkId, (scores.get(item.chunkId) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Limit how many chunks a single document contributes, so one document cannot
 * dominate the result set. Preserves input order.
 */
export function dedupePerDocument<T extends { chunkId: string }>(
  items: ReadonlyArray<T>,
  documentOf: (chunkId: string) => string | undefined,
  maxPerDocument = 2,
): T[] {
  const perDoc = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const doc = documentOf(item.chunkId) ?? item.chunkId;
    const count = perDoc.get(doc) ?? 0;
    if (count >= maxPerDocument) continue;
    perDoc.set(doc, count + 1);
    out.push(item);
  }
  return out;
}
