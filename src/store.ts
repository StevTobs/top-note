import { useSyncExternalStore } from "react";
import {
  type Category,
  type NoteSummary,
  type Preferences,
  defaults,
} from "./model";

// In-memory mirror of the signed-in user's Supabase data. Supabase is the source of
// truth; db.ts writes there first and only then updates this cache.
export type Snapshot = {
  loaded: boolean;
  notes: NoteSummary[];
  categories: Category[];
  preferences: Preferences;
};
const empty = (): Snapshot => ({
  loaded: false,
  notes: [],
  categories: [],
  preferences: defaults,
});
let snapshot: Snapshot = empty();
const listeners = new Set<() => void>();

export const getStore = () => snapshot;
export function setStore(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}
export function resetStore() {
  snapshot = empty();
  listeners.forEach((l) => l());
}
export function upsertSummary(summary: NoteSummary) {
  const notes = snapshot.notes.some((n) => n.id === summary.id)
    ? snapshot.notes.map((n) => (n.id === summary.id ? summary : n))
    : [...snapshot.notes, summary];
  setStore({ notes });
}
export function removeSummary(id: string) {
  setStore({ notes: snapshot.notes.filter((n) => n.id !== id) });
}
export function useStore(): Snapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
