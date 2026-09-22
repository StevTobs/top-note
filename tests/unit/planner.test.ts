import { describe, it, expect } from "vitest";
import {
  type Task,
  type TaskDependency,
  taskDurationDays,
  isOverdue,
  taskDescendantIds,
  effectiveProgress,
  projectProgress,
  wouldCreateDependencyCycle,
  hasDependencyConflict,
  flattenVisibleTasks,
} from "../../src/planner/model";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  projectId: "p1",
  parentTaskId: null,
  kind: "task",
  name: "Task",
  description: "",
  startDate: "2026-01-01",
  endDate: "2026-01-05",
  assignee: "",
  priority: "Medium",
  status: "To Do",
  progress: 0,
  notes: "",
  order: 0,
  favorite: false,
  revision: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...over,
});
const dep = (
  predecessorTaskId: string,
  successorTaskId: string,
  type: TaskDependency["type"] = "FS",
): TaskDependency => ({
  id: `${predecessorTaskId}-${successorTaskId}`,
  predecessorTaskId,
  successorTaskId,
  type,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("taskDurationDays", () => {
  it("counts inclusively, same-day is 1", () => {
    expect(
      taskDurationDays(
        task({ startDate: "2026-01-01", endDate: "2026-01-01" }),
      ),
    ).toBe(1);
    expect(
      taskDurationDays(
        task({ startDate: "2026-01-01", endDate: "2026-01-05" }),
      ),
    ).toBe(5);
  });
});

describe("isOverdue", () => {
  it("is false once Done, even if past end date", () => {
    expect(
      isOverdue(task({ endDate: "2026-01-01", status: "Done" }), "2026-06-01"),
    ).toBe(false);
  });
  it("is true when not Done and past end date", () => {
    expect(
      isOverdue(
        task({ endDate: "2026-01-01", status: "In Progress" }),
        "2026-06-01",
      ),
    ).toBe(true);
  });
  it("is not overdue on the boundary (end date === today)", () => {
    expect(
      isOverdue(task({ endDate: "2026-06-01", status: "To Do" }), "2026-06-01"),
    ).toBe(false);
  });
});

describe("taskDescendantIds", () => {
  it("collects nested descendants but not siblings", () => {
    const tasks = [
      task({ id: "a", parentTaskId: null }),
      task({ id: "b", parentTaskId: "a" }),
      task({ id: "c", parentTaskId: "b" }),
      task({ id: "sibling", parentTaskId: null }),
    ];
    expect(taskDescendantIds(tasks, "a")).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("effectiveProgress", () => {
  it("returns the task's own progress for a leaf", () => {
    const tasks = [task({ id: "a", progress: 40 })];
    expect(effectiveProgress(tasks, "a")).toBe(40);
  });
  it("averages direct children for a parent", () => {
    const tasks = [
      task({ id: "a" }),
      task({ id: "b", parentTaskId: "a", progress: 100 }),
      task({ id: "c", parentTaskId: "a", progress: 0 }),
    ];
    expect(effectiveProgress(tasks, "a")).toBe(50);
  });
  it("propagates the rollup through nested ancestors", () => {
    const tasks = [
      task({ id: "a" }),
      task({ id: "b", parentTaskId: "a" }),
      task({ id: "c", parentTaskId: "b", progress: 60 }),
      task({ id: "d", parentTaskId: "b", progress: 20 }),
    ];
    expect(effectiveProgress(tasks, "b")).toBe(40);
    expect(effectiveProgress(tasks, "a")).toBe(40);
  });
});

describe("projectProgress", () => {
  it("summarises leaf non-milestone tasks and counts milestones separately", () => {
    const tasks = [
      task({ id: "a", status: "Done", progress: 100, endDate: "2020-01-01" }),
      task({
        id: "b",
        status: "In Progress",
        progress: 50,
        endDate: "2099-01-01",
      }),
      task({ id: "c", status: "To Do", progress: 0, endDate: "2020-01-01" }), // overdue
      task({
        id: "m1",
        kind: "milestone",
        status: "Done",
        startDate: "2026-01-01",
        endDate: "2026-01-01",
      }),
      task({
        id: "m2",
        kind: "milestone",
        status: "To Do",
        startDate: "2026-01-01",
        endDate: "2026-01-01",
      }),
    ];
    const result = projectProgress(tasks, "2026-06-01");
    expect(result).toMatchObject({
      total: 3,
      completed: 1,
      inProgress: 1,
      overdue: 1,
      milestonesTotal: 2,
      milestonesReached: 1,
    });
    expect(result.percent).toBe(50); // (100+50+0)/3
  });
  it("excludes a parent task from the leaf rollup once it has children", () => {
    const tasks = [
      task({ id: "parent", progress: 0 }),
      task({
        id: "child",
        parentTaskId: "parent",
        progress: 100,
        status: "Done",
      }),
    ];
    const result = projectProgress(tasks, "2026-06-01");
    expect(result.total).toBe(1);
    expect(result.percent).toBe(100);
  });
});

describe("dependency cycle detection", () => {
  it("flags an edge that would close a cycle (A→B→C, adding C→A)", () => {
    const deps = [dep("a", "b"), dep("b", "c")];
    expect(wouldCreateDependencyCycle(deps, "c", "a")).toBe(true);
  });
  it("does not flag an unrelated edge", () => {
    const deps = [dep("a", "b"), dep("b", "c")];
    expect(wouldCreateDependencyCycle(deps, "d", "e")).toBe(false);
  });
  it("flags a direct self-reference", () => {
    expect(wouldCreateDependencyCycle([], "a", "a")).toBe(true);
  });
});

describe("hasDependencyConflict", () => {
  it("flags when an FS predecessor now finishes after the successor starts", () => {
    const predecessor = task({ id: "p", endDate: "2026-01-10" });
    const successor = task({ id: "s", startDate: "2026-01-05" });
    const byId = new Map([
      [predecessor.id, predecessor],
      [successor.id, successor],
    ]);
    expect(hasDependencyConflict(successor, byId, [dep("p", "s")])).toBe(true);
  });
  it("does not flag when the predecessor finishes before the successor starts", () => {
    const predecessor = task({ id: "p", endDate: "2026-01-01" });
    const successor = task({ id: "s", startDate: "2026-01-05" });
    const byId = new Map([
      [predecessor.id, predecessor],
      [successor.id, successor],
    ]);
    expect(hasDependencyConflict(successor, byId, [dep("p", "s")])).toBe(false);
  });
  it("does not flag a task with no predecessor", () => {
    const successor = task({ id: "s" });
    expect(hasDependencyConflict(successor, new Map(), [])).toBe(false);
  });
});

describe("flattenVisibleTasks", () => {
  it("collapsing a middle node hides only its subtree", () => {
    const tasks = [
      task({ id: "a", order: 0 }),
      task({ id: "b", parentTaskId: "a", order: 0 }),
      task({ id: "c", parentTaskId: "b", order: 0 }),
      task({ id: "d", order: 1 }),
    ];
    const expanded = flattenVisibleTasks(tasks, new Set());
    expect(expanded.map((r) => r.task.id)).toEqual(["a", "b", "c", "d"]);
    const collapsed = flattenVisibleTasks(tasks, new Set(["b"]));
    expect(collapsed.map((r) => r.task.id)).toEqual(["a", "b", "d"]);
  });
});
