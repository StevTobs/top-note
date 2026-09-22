import { describe, it, expect } from "vitest";
import {
  orderBetween,
  needsResequence,
  resequence,
  dropOrder,
} from "../../src/ordering";

describe("orderBetween", () => {
  it("returns the midpoint between two neighbors", () => {
    expect(orderBetween(100, 200)).toBe(150);
  });
  it("returns a value before the first item when dropped at the start", () => {
    const v = orderBetween(null, 5000);
    expect(v).not.toBeNull();
    expect(v!).toBeLessThan(5000);
  });
  it("returns a value after the last item when dropped at the end", () => {
    const v = orderBetween(5000, null);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(5000);
  });
  it("picks a fresh timestamp for an empty list", () => {
    expect(orderBetween(null, null)).not.toBeNull();
  });
  it("signals a resequence is needed once the gap collapses", () => {
    expect(orderBetween(100, 101)).toBeNull();
    expect(orderBetween(100, 100)).toBeNull();
  });
});

describe("needsResequence", () => {
  it("is true only when both neighbors exist and are adjacent", () => {
    expect(needsResequence(100, 101)).toBe(true);
    expect(needsResequence(100, 200)).toBe(false);
    expect(needsResequence(null, 200)).toBe(false);
    expect(needsResequence(100, null)).toBe(false);
  });
});

describe("resequence", () => {
  it("assigns stable, evenly-spaced, strictly increasing values in input order", () => {
    const map = resequence(["a", "b", "c"]);
    const values = ["a", "b", "c"].map((id) => map.get(id)!);
    expect(values[0]).toBeLessThan(values[1]);
    expect(values[1]).toBeLessThan(values[2]);
    // Freshly resequenced neighbors must not immediately need another resequence.
    expect(needsResequence(values[0], values[1])).toBe(false);
  });
});

describe("dropOrder", () => {
  const siblings = [
    { id: "a", order: 100 },
    { id: "b", order: 200 },
    { id: "c", order: 300 },
  ];
  it("inserts between the two neighbors around the drop target", async () => {
    const persist = async () => {};
    expect(await dropOrder(siblings, "b", persist)).toBe(150);
  });
  it("appends at the end when the target is null (drop past the last item)", async () => {
    const persist = async () => {};
    const v = await dropOrder(siblings, null, persist);
    expect(v).toBeGreaterThan(300);
  });
  it("inserts before the first item when dropped at the very start", async () => {
    const persist = async () => {};
    const v = await dropOrder(siblings, "a", persist);
    expect(v).toBeLessThan(100);
  });
  it("resequences the group and retries when the gap has collapsed", async () => {
    const tight = [
      { id: "a", order: 100 },
      { id: "b", order: 101 },
      { id: "c", order: 300 },
    ];
    const persisted: Record<string, number> = {};
    const persist = async (id: string, order: number) => {
      persisted[id] = order;
    };
    const v = await dropOrder(tight, "b", persist);
    // The resequence itself must have been persisted for every sibling...
    expect(Object.keys(persisted).sort()).toEqual(["a", "b", "c"]);
    // ...and the final value must land strictly between the resequenced neighbors.
    expect(v).toBeGreaterThan(persisted["a"]);
    expect(v).toBeLessThan(persisted["b"]);
  });
});
