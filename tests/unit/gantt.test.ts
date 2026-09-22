import { describe, it, expect } from "vitest";
import {
  addDays,
  daysBetween,
  dateToX,
  xToDate,
  PX_PER_DAY,
  type Zoom,
} from "../../src/planner/gantt/scale";

describe("addDays / daysBetween", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
    expect(daysBetween("2026-01-30", "2026-02-02")).toBe(3);
  });
  it("crosses a year boundary", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(daysBetween("2026-12-30", "2027-01-04")).toBe(5);
  });
  it("handles a leap-year February", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
  it("supports negative deltas", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("dateToX / xToDate", () => {
  it("round-trips at every zoom level", () => {
    const rangeStart = "2026-01-01";
    for (const zoom of ["day", "week", "month"] as Zoom[]) {
      const x = dateToX("2026-02-15", rangeStart, zoom);
      expect(x).toBe(daysBetween(rangeStart, "2026-02-15") * PX_PER_DAY[zoom]);
      expect(xToDate(x, rangeStart, zoom)).toBe("2026-02-15");
    }
  });
  it("maps the range start to x = 0", () => {
    expect(dateToX("2026-01-01", "2026-01-01", "day")).toBe(0);
  });
});
