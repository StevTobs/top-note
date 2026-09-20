import Dexie from "dexie";
import { writeBundle, savePreferences } from "./db";
import {
  type Asset,
  type Category,
  type Note,
  type Preferences,
  defaults,
  textOf,
} from "./model";

// Before cloud sync the app kept everything in this browser's IndexedDB. It is only ever
// read here, never modified, so the original stays on the device as a recovery path.
const LEGACY_DB = "clever-note";

export type Legacy = {
  notes: Note[];
  categories: Category[];
  assets: Asset[];
  preferences: Preferences | null;
};
export type LegacyCounts = {
  notes: number;
  categories: number;
  assets: number;
};

async function open(): Promise<Dexie | null> {
  try {
    if (!(await Dexie.exists(LEGACY_DB))) return null;
    const db = new Dexie(LEGACY_DB);
    await db.open(); // no schema declared: opens the existing one as-is
    const names = new Set(db.tables.map((t) => t.name));
    if (!["notes", "categories", "assets"].every((n) => names.has(n))) {
      db.close();
      return null;
    }
    return db;
  } catch {
    return null;
  }
}

/** Counts what is stored on this device without loading image bytes. Null when nothing is there. */
export async function detectLegacy(): Promise<LegacyCounts | null> {
  const db = await open();
  if (!db) return null;
  try {
    const counts = {
      notes: await db.table("notes").count(),
      categories: await db.table("categories").count(),
      assets: await db.table("assets").count(),
    };
    return counts.notes || counts.categories ? counts : null;
  } finally {
    db.close();
  }
}

export async function readLegacy(): Promise<Legacy> {
  const db = await open();
  if (!db) return { notes: [], categories: [], assets: [], preferences: null };
  try {
    const prefs = await db.table("settings").get("preferences");
    return {
      notes: await db.table("notes").toArray(),
      categories: await db.table("categories").toArray(),
      assets: await db.table("assets").toArray(),
      preferences: prefs?.value
        ? {
            ...defaults,
            ...prefs.value,
            connection: { ...defaults.connection, ...prefs.value.connection },
          }
        : null,
    };
  } finally {
    db.close();
  }
}

/** Drops references that would violate a foreign key and re-derives fields the cloud stores. */
export function prepareLegacy(data: Legacy) {
  const categoryIds = new Set(data.categories.map((c) => c.id));
  return {
    categories: data.categories.map((c) => ({
      ...c,
      parentId: c.parentId && categoryIds.has(c.parentId) ? c.parentId : null,
    })),
    assets: data.assets,
    notes: data.notes.map((n) => ({
      ...n,
      categoryId:
        n.categoryId && categoryIds.has(n.categoryId) ? n.categoryId : null,
      plainText: n.plainText ?? textOf(n.document),
      revision: 0,
    })),
  };
}

/**
 * Uploads this device's old notes to the signed-in account. Existing cloud rows are never
 * overwritten, so it is safe to run again after an interruption.
 */
export async function migrateLegacy(
  { copyPreferences }: { copyPreferences: boolean },
  onProgress?: (done: number, total: number) => void,
) {
  const legacy = await readLegacy();
  const bundle = prepareLegacy(legacy);
  await writeBundle(bundle, { skipExisting: true, onProgress });
  if (copyPreferences && legacy.preferences)
    await savePreferences(legacy.preferences);
  return { notes: bundle.notes.length, assets: bundle.assets.length };
}

const flagKey = (userId: string) => `top-note-legacy:${userId}`;
export type LegacyChoice = "done" | "skipped" | null;
export function legacyChoice(userId: string): LegacyChoice {
  try {
    const v = localStorage.getItem(flagKey(userId));
    return v === "done" || v === "skipped" ? v : null;
  } catch {
    return null;
  }
}
export function rememberLegacyChoice(
  userId: string,
  choice: "done" | "skipped",
) {
  try {
    localStorage.setItem(flagKey(userId), choice);
  } catch {
    /* choice is only a convenience; the prompt just appears again */
  }
}
