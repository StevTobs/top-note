/**
 * Gap-based manual ordering shared by every drag-to-reorder list (categories, notes,
 * projects, tasks). Every reorderable table stores a bigint `sort_order` seeded from
 * Date.now(), so siblings created even a millisecond apart start with a huge natural gap;
 * dropping an item between two neighbors just needs their midpoint.
 */

const RESEQUENCE_STEP = 1000;

/** True once the gap between neighbors is too small to bisect any further. */
export function needsResequence(
  before: number | null,
  after: number | null,
): boolean {
  return before !== null && after !== null && after - before < 2;
}

/**
 * The order value to give an item dropped between `before` and `after` (either may be
 * null at the start/end of the list). Returns null when the gap has collapsed and the
 * sibling group must be resequenced first (see `resequence`).
 */
export function orderBetween(
  before: number | null,
  after: number | null,
): number | null {
  if (needsResequence(before, after)) return null;
  if (before === null && after === null) return Date.now();
  if (before === null) return after! - RESEQUENCE_STEP;
  if (after === null) return before + RESEQUENCE_STEP;
  return Math.floor((before + after) / 2);
}

/** Evenly-spaced order values for a sibling group, in the order the ids are given. */
export function resequence(ids: string[]): Map<string, number> {
  const map = new Map<string, number>();
  ids.forEach((id, i) => map.set(id, (i + 1) * RESEQUENCE_STEP));
  return map;
}

/**
 * The order value for an item dropped immediately before `targetId` within `siblings`
 * (the dragged item itself excluded, sorted in current display order). Drops past the
 * last item (or onto an id not present, e.g. an "end of list" drop zone) append at the end.
 * Resequences the whole group first if the gap has collapsed, via the caller's `persist`.
 */
export async function dropOrder(
  siblings: { id: string; order: number }[],
  targetId: string | null,
  persist: (id: string, order: number) => Promise<unknown>,
): Promise<number> {
  const index = targetId ? siblings.findIndex((s) => s.id === targetId) : -1;
  const before = index > 0 ? siblings[index - 1].order : null;
  const after = index >= 0 ? siblings[index].order : null;
  const direct = orderBetween(before, after);
  if (direct !== null) return direct;
  const seq = resequence(siblings.map((s) => s.id));
  await Promise.all(siblings.map((s) => persist(s.id, seq.get(s.id)!)));
  const newBefore = index > 0 ? seq.get(siblings[index - 1].id)! : null;
  const newAfter = index >= 0 ? seq.get(siblings[index].id)! : null;
  return orderBetween(newBefore, newAfter)!;
}
