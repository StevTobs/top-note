import { useSyncExternalStore } from "react";
import {
  type Category,
  type NoteSummary,
  type NoteShare,
  type Preferences,
  defaults,
} from "./model";
import type {
  Project,
  Task,
  TaskDependency,
  ProjectMember,
  ProjectShare,
} from "./planner/model";

// In-memory mirror of the signed-in user's Supabase data. Supabase is the source of
// truth; db.ts writes there first and only then updates this cache.
export type Snapshot = {
  loaded: boolean;
  notes: NoteSummary[];
  categories: Category[];
  preferences: Preferences;
  mySharedNotes: NoteShare[];
  plannerLoaded: boolean;
  projects: Project[];
  tasks: Task[];
  dependencies: TaskDependency[];
  members: ProjectMember[];
  mySharedProjects: ProjectShare[];
};
const empty = (): Snapshot => ({
  loaded: false,
  notes: [],
  categories: [],
  preferences: defaults,
  mySharedNotes: [],
  plannerLoaded: false,
  projects: [],
  tasks: [],
  dependencies: [],
  members: [],
  mySharedProjects: [],
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
export function upsertProject(project: Project) {
  const projects = snapshot.projects.some((p) => p.id === project.id)
    ? snapshot.projects.map((p) => (p.id === project.id ? project : p))
    : [...snapshot.projects, project];
  setStore({ projects });
}
export function removeProject(id: string) {
  setStore({ projects: snapshot.projects.filter((p) => p.id !== id) });
}
export function upsertTask(task: Task) {
  const tasks = snapshot.tasks.some((t) => t.id === task.id)
    ? snapshot.tasks.map((t) => (t.id === task.id ? task : t))
    : [...snapshot.tasks, task];
  setStore({ tasks });
}
export function removeTask(id: string) {
  setStore({ tasks: snapshot.tasks.filter((t) => t.id !== id) });
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
