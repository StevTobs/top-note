import { describe, it, expect, beforeEach, vi } from "vitest";
import Dexie from "dexie";

// A tiny stand-in for the supabase-js query builder: every chained call returns the same
// object, and awaiting it (or maybeSingle) resolves to the next queued result.
const calls: { table: string; method: string; args: unknown[] }[] = [];
let queue: {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}[] = [];
const rpc = vi.fn();
const remove = vi.fn(async () => ({ error: null }));

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
    storage: { from: () => ({ remove }) },
    auth: {},
  },
}));

import {
  saveNote,
  patchNote,
  reorderNote,
  toggleNoteFavorite,
  moveCategory,
  reorderCategory,
  toggleCategoryFavorite,
  deleteCategory,
  permanentlyDeleteNote,
  toSummary,
  noteRow,
  toCategory,
} from "../../src/db";
import { detectLegacy, prepareLegacy, readLegacy } from "../../src/legacy";
import { getStore, resetStore, setStore } from "../../src/store";
import type { Note } from "../../src/model";

const note = (over: Partial<Note> = {}): Note => ({
  id: "11111111-1111-4111-8111-111111111111",
  categoryId: null,
  title: "ภาษาไทย",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  plainText: "",
  sortOrder: 0,
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
  remove.mockClear();
  resetStore();
});

describe("cloud persistence", () => {
  it("saves with optimistic revision check and refreshes the list cache", async () => {
    queue = [{ data: { revision: 1, updated_at: "x" }, error: null }];
    const saved = await saveNote(note({ title: "ใหม่" }), 0);
    expect(saved.revision).toBe(1);
    // Update is conditional on the revision this editor last saw.
    expect(
      calls.some(
        (c) => c.method === "eq" && c.args[0] === "revision" && c.args[1] === 0,
      ),
    ).toBe(true);
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<
      string,
      unknown
    >;
    expect(update).toMatchObject({ title: "ใหม่", revision: 1 });
    expect(getStore().notes[0]).toMatchObject({ title: "ใหม่", revision: 1 });
    expect(getStore().notes[0]).not.toHaveProperty("document");
  });
  it("refuses a stale write instead of overwriting", async () => {
    queue = [{ data: null, error: null }]; // no row matched the expected revision
    await expect(saveNote(note(), 0)).rejects.toThrow("อีกหน้าต่าง");
    expect(getStore().notes).toEqual([]);
  });
  it("surfaces missing tables and network failures in Thai", async () => {
    queue = [
      {
        data: null,
        error: { message: "relation does not exist", code: "42P01" },
      },
    ];
    await expect(saveNote(note(), 0)).rejects.toThrow("0001_init.sql");
    queue = [{ data: null, error: { message: "TypeError: Failed to fetch" } }];
    await expect(saveNote(note(), 0)).rejects.toThrow(
      "เชื่อมต่อ Supabase ไม่ได้",
    );
  });
  it("patches list fields without sending the document", async () => {
    queue = [
      {
        data: {
          id: "n1",
          category_id: null,
          title: "t",
          plain_text: "p",
          sort_order: 0,
          is_favorite: false,
          revision: 4,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          deleted_at: null,
        },
        error: null,
      },
    ];
    const summary = await patchNote("n1", { deletedAt: null }, 3);
    expect(summary.revision).toBe(4);
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<
      string,
      unknown
    >;
    expect(update).toHaveProperty("deleted_at", null);
    expect(update).not.toHaveProperty("document");
  });
  it("reorderNote persists a drag-to-reorder drop under the same revision guard", async () => {
    queue = [{ data: null, error: null }]; // stale revision
    await expect(reorderNote("n1", 500, 3)).rejects.toThrow("อีกหน้าต่าง");
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<
      string,
      unknown
    >;
    expect(update).toMatchObject({ sort_order: 500, revision: 4 });
  });
  it("toggleNoteFavorite flips is_favorite under the same revision guard", async () => {
    queue = [
      {
        data: {
          id: "n1",
          category_id: null,
          title: "t",
          plain_text: "",
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
    const summary = await toggleNoteFavorite("n1", true, 0);
    expect(summary.favorite).toBe(true);
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<
      string,
      unknown
    >;
    expect(update).toMatchObject({ is_favorite: true });
  });
  it("reorderCategory writes sort_order without a revision guard", async () => {
    setStore({
      categories: [
        {
          id: "a",
          parentId: null,
          name: "A",
          order: 0,
          favorite: false,
          deletedAt: null,
        },
      ],
    });
    queue = [{ data: null, error: null }];
    await reorderCategory("a", 750);
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<
      string,
      unknown
    >;
    expect(update).toEqual({ sort_order: 750 });
    expect(getStore().categories[0].order).toBe(750);
  });
  it("toggleCategoryFavorite writes is_favorite without a revision guard", async () => {
    setStore({
      categories: [
        {
          id: "a",
          parentId: null,
          name: "A",
          order: 0,
          favorite: false,
          deletedAt: null,
        },
      ],
    });
    queue = [{ data: null, error: null }];
    await toggleCategoryFavorite("a", true);
    expect(getStore().categories[0].favorite).toBe(true);
  });
  it("maps database category errors to user messages", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "category_cycle" } });
    await expect(moveCategory("a", "b", "A")).rejects.toThrow(
      "ย้ายหมวดหมู่เข้าในตัวเอง",
    );
    rpc.mockResolvedValueOnce({
      error: { message: "category_parent_missing" },
    });
    await expect(moveCategory("a", "b", "A")).rejects.toThrow(
      "ไม่พบหมวดหมู่ปลายทาง",
    );
  });
  it("deletes a category through one atomic RPC", async () => {
    rpc.mockResolvedValue({ error: null });
    queue = [
      { data: [], error: null }, // categories refetch
      { data: [], error: null }, // notes refetch
    ];
    setStore({
      categories: [
        {
          id: "a",
          parentId: null,
          name: "A",
          order: 0,
          favorite: false,
          deletedAt: null,
        },
      ],
    });
    await deleteCategory("a", true);
    expect(rpc).toHaveBeenCalledWith("delete_category", {
      p_id: "a",
      p_trash_notes: true,
    });
  });
  it("permanent delete only allows trash and removes returned orphan images", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "note_not_in_trash" },
    });
    await expect(permanentlyDeleteNote("n1")).rejects.toThrow("ในถังขยะ");
    rpc.mockResolvedValueOnce({ data: ["img-1"], error: null });
    setStore({
      notes: [
        toSummary({
          id: "n1",
          category_id: null,
          title: "",
          plain_text: "",
          sort_order: 0,
          is_favorite: false,
          revision: 0,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          deleted_at: "2026-01-02T00:00:00Z",
        }),
      ],
    });
    await permanentlyDeleteNote("n1");
    expect(getStore().notes).toEqual([]);
    expect(remove).toHaveBeenCalledWith(["user-1/img-1"]);
  });
});

describe("row mapping", () => {
  it("normalises Postgres timestamps so lexical sorting stays valid", () => {
    const s = toSummary({
      id: "n",
      category_id: null,
      title: "",
      plain_text: "",
      sort_order: 0,
      is_favorite: false,
      revision: 0,
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-01T00:00:00.45+00:00",
      deleted_at: null,
    });
    expect(s.updatedAt).toBe("2026-01-01T00:00:00.450Z");
    expect(s.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
  it("derives asset_ids from the document and maps categories", () => {
    const row = noteRow(
      note({
        document: {
          type: "doc",
          content: [{ type: "image", attrs: { assetId: "a-1" } }],
        },
      }),
    );
    expect(row.asset_ids).toEqual(["a-1"]);
    expect(
      toCategory({
        id: "c",
        parent_id: "p",
        name: "N",
        sort_order: 5,
        is_favorite: true,
        deleted_at: null,
      }),
    ).toEqual({
      id: "c",
      parentId: "p",
      name: "N",
      order: 5,
      favorite: true,
      deletedAt: null,
    });
  });
});

describe("legacy IndexedDB data", () => {
  it("is detected read-only and prepared without dangling references", async () => {
    expect(await detectLegacy()).toBeNull();
    const old = new Dexie("clever-note");
    old.version(2).stores({
      notes: "id, categoryId, updatedAt",
      categories: "id, parentId, order",
      assets: "id",
      settings: "id",
    });
    await old.table("categories").bulkAdd([
      { id: "a", name: "A", parentId: null, order: 0, deletedAt: null },
      { id: "b", name: "B", parentId: "gone", order: 1, deletedAt: null },
    ]);
    await old
      .table("notes")
      .bulkAdd([
        { ...note({ id: "n1", categoryId: "b", revision: 7 }) },
        { ...note({ id: "n2", categoryId: "missing" }) },
      ]);
    old.close();
    expect(await detectLegacy()).toEqual({
      notes: 2,
      categories: 2,
      assets: 0,
    });
    const prepared = prepareLegacy(await readLegacy());
    expect(prepared.categories.find((c) => c.id === "b")?.parentId).toBeNull();
    expect(prepared.notes.find((n) => n.id === "n2")?.categoryId).toBeNull();
    expect(prepared.notes.every((n) => n.revision === 0)).toBe(true);
    // Reading must leave the original untouched.
    expect(await detectLegacy()).toEqual({
      notes: 2,
      categories: 2,
      assets: 0,
    });
  });
});
