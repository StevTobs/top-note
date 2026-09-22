import { describe, it, expect, beforeEach, vi } from "vitest";

// Same hand-rolled stand-in for the supabase-js query builder as tests/unit/cloud.test.ts:
// every chained call records itself, and awaiting (or .maybeSingle()) resolves the next
// queued result.
const calls: { table: string; method: string; args: unknown[] }[] = [];
let queue: {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}[] = [];
const rpc = vi.fn();

function builder(table: string) {
  const next = () => queue.shift() ?? { data: null, error: null };
  const b: Record<string, unknown> = {};
  for (const m of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "in",
    "order",
    "range",
  ])
    b[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return b;
    };
  b.maybeSingle = async () => next();
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(next()).then(res, rej);
  return b;
}

vi.mock("../../src/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/supabase")>()),
  currentUserId: async () => "user-1",
  supabase: {
    from: (table: string) => builder(table),
    rpc: (...args: unknown[]) => rpc(...args),
    storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })) }) },
    auth: {},
  },
}));

import {
  createProject,
  saveTask,
  reorderTask,
  toggleTaskFavorite,
  deleteTask,
  addDependency,
  shareProject,
  unshareProject,
  fetchProjectShares,
} from "../../src/planner/db";
import { getStore, resetStore } from "../../src/store";
import type { Task } from "../../src/planner/model";

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

beforeEach(() => {
  calls.length = 0;
  queue = [];
  rpc.mockReset();
  resetStore();
});

describe("planner data layer", () => {
  it("createProject inserts the expected row shape and updates the store", async () => {
    const project = await createProject({
      name: "Website relaunch",
      owner: "Alex",
    });
    const insert = calls.find(
      (c) => c.table === "projects" && c.method === "insert",
    )!.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      name: "Website relaunch",
      owner: "Alex",
      status: "Planning",
    });
    expect(getStore().projects).toEqual([project]);
  });

  it("saveTask refuses a stale write instead of overwriting", async () => {
    queue = [{ data: null, error: null }]; // no row matched the expected revision
    await expect(saveTask(task(), 0)).rejects.toThrow("อีกหน้าต่าง");
    expect(getStore().tasks).toEqual([]);
  });

  it("saveTask applies the revision guard and updates the store on success", async () => {
    queue = [
      {
        data: { revision: 1, updated_at: "2026-01-02T00:00:00.000Z" },
        error: null,
      },
    ];
    const saved = await saveTask(task({ name: "Renamed" }), 0);
    expect(saved.revision).toBe(1);
    expect(
      calls.some(
        (c) => c.method === "eq" && c.args[0] === "revision" && c.args[1] === 0,
      ),
    ).toBe(true);
    expect(getStore().tasks[0]).toMatchObject({ name: "Renamed", revision: 1 });
  });

  it("reorderTask persists a drag-to-reorder drop under the same revision guard", async () => {
    queue = [{ data: null, error: null }]; // stale revision
    await expect(reorderTask("t1", 500, 3)).rejects.toThrow("อีกหน้าต่าง");
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<
      string,
      unknown
    >;
    expect(update).toMatchObject({ sort_order: 500, revision: 4 });
  });

  it("toggleTaskFavorite flips is_favorite under the same revision guard", async () => {
    queue = [
      {
        data: {
          id: "t1",
          project_id: "p1",
          parent_task_id: null,
          kind: "task",
          name: "Task",
          description: "",
          start_date: "2026-01-01",
          end_date: "2026-01-05",
          assignee: "",
          priority: "Medium",
          status: "To Do",
          progress: 0,
          notes: "",
          sort_order: 0,
          is_favorite: true,
          revision: 1,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          deleted_at: null,
        },
        error: null,
      },
    ];
    const task = await toggleTaskFavorite("t1", true, 0);
    expect(task.favorite).toBe(true);
  });

  it("deleteTask calls the delete_task RPC with the task id", async () => {
    rpc.mockResolvedValue({ error: null });
    queue = [
      { data: [], error: null }, // tasks refetch
      { data: [], error: null }, // dependencies refetch
    ];
    await deleteTask("t1");
    expect(rpc).toHaveBeenCalledWith("delete_task", { p_id: "t1" });
  });

  it("maps a dependency_cycle RPC error to a Thai message", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "dependency_cycle" } });
    await expect(addDependency("a", "b")).rejects.toThrow("วนซ้ำ");
  });

  it("adds a dependency and refreshes the store on success", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    queue = [
      {
        data: [
          {
            id: "d1",
            predecessor_task_id: "a",
            successor_task_id: "b",
            dependency_type: "FS",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
    ];
    await addDependency("a", "b");
    expect(rpc).toHaveBeenCalledWith("add_task_dependency", {
      p_id: expect.any(String),
      p_predecessor_id: "a",
      p_successor_id: "b",
      p_type: "FS",
    });
    expect(getStore().dependencies).toEqual([
      {
        id: "d1",
        predecessorTaskId: "a",
        successorTaskId: "b",
        type: "FS",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("sharing", () => {
  it("shareProject resolves the invitee by email and inserts a share row", async () => {
    rpc.mockResolvedValueOnce({ data: "user-2", error: null });
    queue = [
      {
        data: {
          id: "s1",
          project_id: "p1",
          owner_id: "user-1",
          owner_email: "owner@example.com",
          shared_with_user_id: "user-2",
          shared_with_email: "friend@example.com",
          created_at: "2026-01-01T00:00:00Z",
        },
        error: null,
      },
    ];
    const share = await shareProject("p1", "friend@example.com");
    expect(rpc).toHaveBeenCalledWith("find_user_id_by_email", {
      p_email: "friend@example.com",
    });
    expect(share).toMatchObject({
      projectId: "p1",
      sharedWithEmail: "friend@example.com",
    });
  });
  it("shareProject refuses an email that has never signed in", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(shareProject("p1", "nobody@example.com")).rejects.toThrow(
      "เคยเข้าสู่ระบบ",
    );
  });
  it("unshareProject deletes the share row by id", async () => {
    queue = [{ data: null, error: null }];
    await unshareProject("s1");
    expect(
      calls.some((c) => c.table === "project_shares" && c.method === "delete"),
    ).toBe(true);
  });
  it("fetchProjectShares lists collaborators for a project", async () => {
    queue = [
      {
        data: [
          {
            id: "s1",
            project_id: "p1",
            owner_id: "user-1",
            owner_email: "owner@example.com",
            shared_with_user_id: "user-2",
            shared_with_email: "friend@example.com",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
    ];
    const shares = await fetchProjectShares("p1");
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ sharedWithEmail: "friend@example.com" });
  });
});
