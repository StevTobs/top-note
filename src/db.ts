import type { JSONContent } from "@tiptap/react";
import { withNoteLocks } from "./locks";
import { fail, supabase, currentUserId } from "./supabase";
import { putAsset, removeAssetObjects, removeAssetRows } from "./assets";
import { getStore, setStore, upsertSummary, removeSummary } from "./store";
import {
  type Note,
  type NoteSummary,
  type Category,
  type Asset,
  type Preferences,
  defaults,
  uid,
  now,
  textOf,
  descendants,
  assetIds,
} from "./model";

// ─── Row mapping (snake_case Postgres ⇄ camelCase app model) ────────────────

type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  is_favorite: boolean;
  deleted_at: string | null;
};
type SummaryRow = {
  id: string;
  category_id: string | null;
  title: string;
  plain_text: string;
  sort_order: number;
  is_favorite: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type NoteRow = SummaryRow & { document: JSONContent };

const CATEGORY_COLUMNS =
  "id, parent_id, name, sort_order, is_favorite, deleted_at";
const SUMMARY_COLUMNS =
  "id, category_id, title, plain_text, sort_order, is_favorite, revision, created_at, updated_at, deleted_at";
const NOTE_COLUMNS = `${SUMMARY_COLUMNS}, document`;
// Timestamps are normalised to toISOString(): Postgres trims trailing zeros, which would
// otherwise break the lexical updatedAt sort the note list relies on.
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

export const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  order: Number(r.sort_order),
  favorite: r.is_favorite,
  deletedAt: iso(r.deleted_at),
});
export const toSummary = (r: SummaryRow): NoteSummary => ({
  id: r.id,
  categoryId: r.category_id,
  title: r.title,
  plainText: r.plain_text,
  sortOrder: Number(r.sort_order),
  favorite: r.is_favorite,
  revision: r.revision,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  deletedAt: iso(r.deleted_at),
});
export const toNote = (r: NoteRow): Note => ({
  ...toSummary(r),
  document: r.document,
});
export const noteRow = (n: Note) => ({
  id: n.id,
  category_id: n.categoryId,
  title: n.title,
  document: n.document,
  plain_text: n.plainText,
  asset_ids: assetIds(n.document),
  sort_order: Number(n.sortOrder) || 0,
  is_favorite: n.favorite,
  revision: n.revision,
  created_at: n.createdAt,
  updated_at: n.updatedAt,
  deleted_at: n.deletedAt,
});
export const categoryRow = (c: Category) => ({
  id: c.id,
  parent_id: c.parentId,
  name: c.name,
  sort_order: Number(c.order) || 0,
  is_favorite: c.favorite,
  deleted_at: c.deletedAt,
});
const summaryOf = (n: Note | NoteSummary): NoteSummary => ({
  id: n.id,
  categoryId: n.categoryId,
  title: n.title,
  plainText: n.plainText,
  sortOrder: n.sortOrder,
  favorite: n.favorite,
  revision: n.revision,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  deletedAt: n.deletedAt,
});

// ─── Reads ───────────────────────────────────────────────────────────────────

// PostgREST caps a response at 1000 rows by default, so list queries must page.
const PAGE = 1000;
export async function pages<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string; code?: string } | null;
  }>,
  fallback: string,
  size = PAGE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query(from, from + size - 1);
    if (error) throw fail(error, fallback);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < size) return out;
  }
}

export async function fetchCategories(): Promise<Category[]> {
  const rows = await pages<CategoryRow>(
    (a, b) =>
      supabase
        .from("categories")
        .select(CATEGORY_COLUMNS)
        .order("sort_order")
        .order("id")
        .range(a, b),
    "โหลดหมวดหมู่ไม่สำเร็จ",
  );
  return rows.map(toCategory);
}
export async function fetchSummaries(): Promise<NoteSummary[]> {
  const rows = await pages<SummaryRow>(
    (a, b) =>
      supabase.from("notes").select(SUMMARY_COLUMNS).order("id").range(a, b),
    "โหลดรายการโน้ตไม่สำเร็จ",
  );
  return rows.map(toSummary);
}
export async function fetchNote(id: string): Promise<Note | null> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fail(error, "โหลดโน้ตไม่สำเร็จ");
  return data ? toNote(data as NoteRow) : null;
}
/** Full documents, for backup. Small pages keep each response well under API size limits. */
export async function fetchAllNotes(): Promise<Note[]> {
  const rows = await pages<NoteRow>(
    (a, b) =>
      supabase.from("notes").select(NOTE_COLUMNS).order("id").range(a, b),
    "โหลดโน้ตไม่สำเร็จ",
    100,
  );
  return rows.map(toNote);
}
export async function fetchPreferences(): Promise<Preferences | null> {
  const { data, error } = await supabase
    .from("preferences")
    .select("value")
    .maybeSingle();
  if (error) throw fail(error, "โหลดการตั้งค่าไม่สำเร็จ");
  if (!data) return null;
  const value = data.value as Partial<Preferences>;
  return {
    ...defaults,
    ...value,
    connection: { ...defaults.connection, ...value.connection },
  };
}

export async function refreshCategories() {
  setStore({ categories: await fetchCategories() });
}
export async function refreshNotes() {
  const started = now();
  const remote = await fetchSummaries();
  const local = new Map(getStore().notes.map((n) => [n.id, n]));
  const remoteIds = new Set(remote.map((n) => n.id));
  // A save or create that finished while this fetch was in flight is newer than the snapshot.
  const merged = remote.map((r) => {
    const l = local.get(r.id);
    return l && l.revision > r.revision ? l : r;
  });
  for (const l of local.values())
    if (!remoteIds.has(l.id) && l.createdAt >= started) merged.push(l);
  setStore({ notes: merged });
}
/** First load after sign-in. */
export async function loadAll() {
  const [categories, notes, preferences] = await Promise.all([
    fetchCategories(),
    fetchSummaries(),
    fetchPreferences(),
  ]);
  setStore({
    loaded: true,
    categories,
    notes,
    preferences: preferences ?? defaults,
  });
}
/** Re-sync after the tab was hidden or offline, so other devices' edits show up. */
export async function refreshAll() {
  const [, , preferences] = await Promise.all([
    refreshCategories(),
    refreshNotes(),
    fetchPreferences(),
  ]);
  if (preferences) setStore({ preferences });
}

// ─── Account setup ───────────────────────────────────────────────────────────

/** Creates the per-user preferences row on first sign-in. `created` is true only once. */
export async function ensureAccount(): Promise<{ created: boolean }> {
  if (await fetchPreferences()) return { created: false };
  const { error } = await supabase
    .from("preferences")
    .insert({ value: defaults });
  // 23505: another tab won the race to create it.
  if (error && error.code !== "23505")
    throw fail(error, "สร้างพื้นที่ทำงานไม่สำเร็จ");
  return { created: !error };
}
export async function savePreferences(value: Preferences) {
  const { error } = await supabase.from("preferences").upsert({
    user_id: await currentUserId(),
    value,
    updated_at: now(),
  });
  if (error) throw fail(error, "บันทึกการตั้งค่าไม่สำเร็จ");
  setStore({ preferences: value });
}
export async function seedWelcome() {
  const categoryId = uid();
  const paragraph = (text: string): JSONContent => ({
    type: "paragraph",
    attrs: { blockId: uid() },
    content: [{ type: "text", text }],
  });
  const document: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, blockId: uid() },
        content: [{ type: "text", text: "พื้นที่สำหรับความคิดของคุณ" }],
      },
      paragraph(
        "บางความคิดเริ่มจากประโยคสั้น ๆ บางไอเดียต้องการพื้นที่อีกนิด ยินดีต้อนรับสู่ Top Note — จดสิ่งสำคัญ จัดระเบียบในแบบคุณ แล้วค่อย ๆ เชื่อมโยงมันเข้าด้วยกัน",
      ),
      {
        type: "heading",
        attrs: { level: 2, blockId: uid() },
        content: [{ type: "text", text: "01 / เริ่มจากสิ่งที่อยู่ในหัว" }],
      },
      {
        type: "paragraph",
        attrs: { blockId: uid() },
        content: [
          { type: "text", text: "เขียนได้อย่างอิสระ " },
          {
            type: "text",
            text: "ไฮไลต์สิ่งที่สำคัญ",
            marks: [{ type: "highlight", attrs: { color: "#b7ff3c" } }],
          },
          {
            type: "text",
            text: " ใส่ลิงก์ หรือวางรูปจาก clipboard ลงในโน้ตได้เลย ใช้ / เพื่อเปิดเมนูเพิ่มเนื้อหา",
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2, blockId: uid() },
        content: [{ type: "text", text: "02 / ให้ทุกไอเดียมีที่อยู่" }],
      },
      paragraph(
        "สร้างหมวดหมู่สำหรับงาน การเรียนรู้ หรือเรื่องส่วนตัว แล้วแบ่งเป็นหมวดย่อยเท่าที่ต้องการ ทุกโน้ตถูกบันทึกลงบัญชีของคุณโดยอัตโนมัติ และเปิดอ่านได้จากทุกอุปกรณ์ที่ล็อกอิน",
      ),
      {
        type: "heading",
        attrs: { level: 2, blockId: uid() },
        content: [{ type: "text", text: "03 / คิดให้ชัดขึ้นด้วย AI" }],
      },
      paragraph(
        "เลือกข้อความเพียงบางส่วน แล้วกด “สรุปส่วนนี้” เพื่อให้ AI ช่วยย่อความ คุณจะเห็นตัวอย่างก่อนเลือกแทรกหรือแทนที่เสมอ ส่วนที่เหลือของโน้ตจะไม่ถูกส่งไปด้วย",
      ),
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph("สร้างโน้ตแรกของคุณ")],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph("เชื่อมต่อ AI ในการตั้งค่า")],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph("สำรองข้อมูลเก็บไว้เป็นระยะ")],
          },
        ],
      },
    ],
  };
  const category: Category = {
    id: categoryId,
    parentId: null,
    name: "Getting started",
    order: 0,
    favorite: false,
    deletedAt: null,
  };
  const note: Note = {
    id: uid(),
    categoryId,
    title: "A little space for big ideas",
    document,
    plainText: textOf(document),
    sortOrder: Date.now(),
    favorite: false,
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await writeBundle({ categories: [category], assets: [], notes: [note] });
}

// ─── Notes ───────────────────────────────────────────────────────────────────

const CONFLICT = "โน้ตเปลี่ยนจากอีกหน้าต่าง กรุณาเก็บสำเนาข้อความและโหลดใหม่";

export async function createNote(categoryId: string | null) {
  const note: Note = {
    id: uid(),
    categoryId,
    title: "โน้ตใหม่",
    document: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { blockId: uid() } }],
    },
    plainText: "",
    sortOrder: Date.now(),
    favorite: false,
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  const { error } = await supabase.from("notes").insert(noteRow(note));
  if (error) throw fail(error, "สร้างโน้ตไม่สำเร็จ");
  upsertSummary(summaryOf(note));
  return note;
}

/**
 * Optimistic concurrency: the update only matches while the stored revision is still the one
 * this editor last saw, so a write from another device or tab can never be silently overwritten.
 */
export async function saveNote(note: Note, expectedRevision: number) {
  const updatedAt = now();
  const { data, error } = await supabase
    .from("notes")
    .update({
      category_id: note.categoryId,
      title: note.title,
      document: note.document,
      plain_text: note.plainText,
      asset_ids: assetIds(note.document),
      deleted_at: note.deletedAt,
      revision: expectedRevision + 1,
      updated_at: updatedAt,
    })
    .eq("id", note.id)
    .eq("revision", expectedRevision)
    .select("revision, updated_at")
    .maybeSingle();
  if (error) throw fail(error, "บันทึกโน้ตไม่สำเร็จ");
  if (!data) throw new Error(CONFLICT);
  const next = { ...note, revision: data.revision as number, updatedAt };
  upsertSummary(summaryOf(next));
  return next;
}

/** Changes only list-level fields, so it is safe to call without the note's document loaded. */
export async function patchNote(
  id: string,
  patch: { categoryId?: string | null; deletedAt?: string | null },
  expectedRevision: number,
) {
  const row: Record<string, unknown> = {
    revision: expectedRevision + 1,
    updated_at: now(),
  };
  if ("categoryId" in patch) row.category_id = patch.categoryId;
  if ("deletedAt" in patch) row.deleted_at = patch.deletedAt;
  const { data, error } = await supabase
    .from("notes")
    .update(row)
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select(SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw fail(error, "อัปเดตโน้ตไม่สำเร็จ");
  if (!data) throw new Error(CONFLICT);
  const summary = toSummary(data as SummaryRow);
  upsertSummary(summary);
  return summary;
}

/** Persists a drag-to-reorder drop; same revision guard as patchNote. */
export async function reorderNote(
  id: string,
  sortOrder: number,
  expectedRevision: number,
) {
  const { data, error } = await supabase
    .from("notes")
    .update({
      sort_order: sortOrder,
      revision: expectedRevision + 1,
      updated_at: now(),
    })
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select(SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw fail(error, "จัดลำดับโน้ตไม่สำเร็จ");
  if (!data) throw new Error(CONFLICT);
  const summary = toSummary(data as SummaryRow);
  upsertSummary(summary);
  return summary;
}

export async function toggleNoteFavorite(
  id: string,
  favorite: boolean,
  expectedRevision: number,
) {
  const { data, error } = await supabase
    .from("notes")
    .update({
      is_favorite: favorite,
      revision: expectedRevision + 1,
      updated_at: now(),
    })
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select(SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw fail(error, "ปักหมุดโน้ตไม่สำเร็จ");
  if (!data) throw new Error(CONFLICT);
  const summary = toSummary(data as SummaryRow);
  upsertSummary(summary);
  return summary;
}

export async function permanentlyDeleteNote(id: string) {
  const { data, error } = await supabase.rpc("delete_note_permanently", {
    p_id: id,
  });
  if (error)
    throw /note_not_in_trash/.test(error.message)
      ? new Error("ลบถาวรได้เฉพาะโน้ตในถังขยะ")
      : fail(error, "ลบโน้ตไม่สำเร็จ");
  removeSummary(id);
  // The database returned only images no other note uses. A leftover object is harmless
  // (private, unreferenced), so a Storage failure must not undo the deletion.
  await removeAssetObjects((data as string[]) ?? []).catch(() => {});
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function addCategory(name: string, parentId: string | null) {
  const category: Category = {
    id: uid(),
    name,
    parentId,
    order: Date.now(),
    favorite: false,
    deletedAt: null,
  };
  const { error } = await supabase
    .from("categories")
    .insert(categoryRow(category));
  if (error) throw fail(error, "สร้างหมวดหมู่ไม่สำเร็จ");
  setStore({ categories: [...getStore().categories, category] });
  return category;
}

/** Persists a drag-to-reorder drop among sibling categories. No revision on this table. */
export async function reorderCategory(id: string, order: number) {
  const { error } = await supabase
    .from("categories")
    .update({ sort_order: order })
    .eq("id", id);
  if (error) throw fail(error, "จัดลำดับหมวดหมู่ไม่สำเร็จ");
  setStore({
    categories: getStore().categories.map((c) =>
      c.id === id ? { ...c, order } : c,
    ),
  });
}

export async function toggleCategoryFavorite(id: string, favorite: boolean) {
  const { error } = await supabase
    .from("categories")
    .update({ is_favorite: favorite })
    .eq("id", id);
  if (error) throw fail(error, "ปักหมุดหมวดหมู่ไม่สำเร็จ");
  setStore({
    categories: getStore().categories.map((c) =>
      c.id === id ? { ...c, favorite } : c,
    ),
  });
}

export async function moveCategory(
  id: string,
  parentId: string | null,
  name: string,
) {
  const { error } = await supabase.rpc("move_category", {
    p_id: id,
    p_parent_id: parentId,
    p_name: name,
  });
  if (error) {
    if (/category_cycle/.test(error.message))
      throw new Error("ย้ายหมวดหมู่เข้าในตัวเองหรือหมวดย่อยไม่ได้");
    if (/category_parent_missing/.test(error.message))
      throw new Error("ไม่พบหมวดหมู่ปลายทาง");
    throw fail(error, "ย้ายหมวดหมู่ไม่สำเร็จ");
  }
  await refreshCategories();
}
export async function deleteCategory(id: string, trashNotes: boolean) {
  const { categories, notes } = getStore();
  const affected = descendants(categories, id);
  const noteIds = notes
    .filter((n) => !!n.categoryId && affected.has(n.categoryId) && !n.deletedAt)
    .map((n) => n.id);
  // Tabs on this device that are editing an affected note must hand it over first.
  await withNoteLocks(noteIds, async () => {
    const { error } = await supabase.rpc("delete_category", {
      p_id: id,
      p_trash_notes: trashNotes,
    });
    if (error) throw fail(error, "ลบหมวดหมู่ไม่สำเร็จ");
  });
  await Promise.all([refreshCategories(), refreshNotes()]);
}
export async function restoreCategory(id: string) {
  const { error } = await supabase.rpc("restore_category", { p_id: id });
  if (error) throw fail(error, "กู้คืนหมวดหมู่ไม่สำเร็จ");
  await Promise.all([refreshCategories(), refreshNotes()]);
}

// ─── Bulk write (ZIP import and local-data migration) ────────────────────────

export type Bundle = {
  categories: Category[];
  assets: Asset[];
  notes: Note[];
};
const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

/**
 * Writes categories → images → notes. Supabase has no multi-request transaction, so:
 * - `skipExisting: false` (import) rolls back what it wrote if any step fails;
 * - `skipExisting: true` (migration) never overwrites an existing row, so it can simply be
 *   re-run after a failure and never clobbers edits made since.
 */
export async function writeBundle(
  bundle: Bundle,
  {
    skipExisting = false,
    onProgress,
  }: {
    skipExisting?: boolean;
    onProgress?: (done: number, total: number) => void;
  } = {},
) {
  const total = bundle.assets.length + bundle.notes.length;
  let done = 0;
  const written = {
    categories: [] as string[],
    assets: [] as string[],
    notes: [] as string[],
  };
  const insert = (table: string, rows: object[]) =>
    skipExisting
      ? supabase
          .from(table)
          .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
      : supabase.from(table).insert(rows);
  try {
    if (bundle.categories.length) {
      // One statement: Postgres checks the parent_id foreign key after the whole insert.
      const { error } = await insert(
        "categories",
        bundle.categories.map(categoryRow),
      );
      if (error) throw fail(error, "บันทึกหมวดหมู่ไม่สำเร็จ");
      written.categories = bundle.categories.map((c) => c.id);
    }
    for (const group of chunk(bundle.assets, 3)) {
      await Promise.all(
        group.map(async (a) => {
          await putAsset(a, { skipExisting });
          written.assets.push(a.id);
          onProgress?.(++done, total);
        }),
      );
    }
    for (const group of chunk(bundle.notes, 25)) {
      const { error } = await insert("notes", group.map(noteRow));
      if (error) throw fail(error, "บันทึกโน้ตไม่สำเร็จ");
      written.notes.push(...group.map((n) => n.id));
      done += group.length;
      onProgress?.(done, total);
    }
  } catch (e) {
    if (!skipExisting) await rollback(written).catch(() => {});
    throw e;
  }
  await Promise.all([refreshCategories(), refreshNotes()]);
}
async function rollback(written: {
  categories: string[];
  assets: string[];
  notes: string[];
}) {
  for (const ids of chunk(written.notes, 100))
    await supabase.from("notes").delete().in("id", ids);
  await removeAssetObjects(written.assets).catch(() => {});
  for (const ids of chunk(written.assets, 100)) await removeAssetRows(ids);
  for (const ids of chunk(written.categories, 100))
    await supabase.from("categories").delete().in("id", ids);
}
