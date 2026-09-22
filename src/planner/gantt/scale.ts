export type Zoom = "day" | "week" | "month";
export const PX_PER_DAY: Record<Zoom, number> = { day: 36, week: 14, month: 4 };
export const ROW_HEIGHT = 34;

const DAY_MS = 86_400_000;

/** UTC-safe: avoids local-timezone DST drift when adding/diffing "YYYY-MM-DD" dates. */
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  const from = new Date(a + "T00:00:00Z").getTime(),
    to = new Date(b + "T00:00:00Z").getTime();
  return Math.round((to - from) / DAY_MS);
}
export function dateToX(date: string, rangeStart: string, zoom: Zoom): number {
  return daysBetween(rangeStart, date) * PX_PER_DAY[zoom];
}
export function xToDate(x: number, rangeStart: string, zoom: Zoom): string {
  return addDays(rangeStart, Math.round(x / PX_PER_DAY[zoom]));
}
