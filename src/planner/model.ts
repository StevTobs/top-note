export type ProjectStatus =
  "Planning" | "In Progress" | "On Hold" | "Completed";
export const PROJECT_STATUSES: ProjectStatus[] = [
  "Planning",
  "In Progress",
  "On Hold",
  "Completed",
];
export type Project = {
  id: string;
  name: string;
  description: string;
  startDate: string | null; // "YYYY-MM-DD"
  endDate: string | null; // "YYYY-MM-DD"
  owner: string;
  status: ProjectStatus;
  order: number;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TaskKind = "task" | "milestone";
export type TaskPriority = "Low" | "Medium" | "High" | "Critical";
export const TASK_PRIORITIES: TaskPriority[] = [
  "Low",
  "Medium",
  "High",
  "Critical",
];
export type TaskStatus = "To Do" | "In Progress" | "Review" | "Done";
export const TASK_STATUSES: TaskStatus[] = [
  "To Do",
  "In Progress",
  "Review",
  "Done",
];
export type Task = {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  kind: TaskKind;
  name: string;
  description: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  assignee: string;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  notes: string;
  order: number;
  favorite: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type TaskDependency = {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: DependencyType;
  createdAt: string;
};

export type ProjectMember = {
  id: string;
  projectId: string;
  name: string;
  role: string;
  createdAt: string;
};

/** Date-only "today" (YYYY-MM-DD), for comparing against task start/end dates. */
export const today = () => new Date().toISOString().slice(0, 10);

export const isMilestone = (task: Task) => task.kind === "milestone";
export const isSubtask = (task: Task) => task.parentTaskId !== null;

/** Inclusive day count, e.g. a task starting and ending the same day has duration 1. */
export function taskDurationDays(task: Task): number {
  const start = new Date(task.startDate + "T00:00:00Z").getTime(),
    end = new Date(task.endDate + "T00:00:00Z").getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

export function isOverdue(task: Task, referenceDate: string): boolean {
  return task.status !== "Done" && task.endDate < referenceDate;
}

/** Same fixed-point iteration as `descendants()` in src/model.ts, over parentTaskId. */
export function taskDescendantIds(tasks: Task[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tasks)
      if (t.parentTaskId && ids.has(t.parentTaskId) && !ids.has(t.id)) {
        ids.add(t.id);
        changed = true;
      }
  }
  return ids;
}

export function taskChildren(tasks: Task[], parentId: string | null): Task[] {
  return tasks
    .filter((t) => !t.deletedAt && t.parentTaskId === parentId)
    .sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order,
    );
}

/**
 * A leaf task's progress is whatever the user set. A parent's progress is the unweighted
 * average of its direct children's effective progress, recursively — so editing a subtask
 * rolls up through every ancestor automatically.
 */
export function effectiveProgress(tasks: Task[], taskId: string): number {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return 0;
  const children = taskChildren(tasks, taskId);
  if (!children.length) return task.progress;
  const sum = children.reduce(
    (acc, c) => acc + effectiveProgress(tasks, c.id),
    0,
  );
  return Math.round(sum / children.length);
}

export type ProjectProgress = {
  percent: number;
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  milestonesTotal: number;
  milestonesReached: number;
};

/** Computed over leaf, non-milestone tasks; milestones are reported separately. */
export function projectProgress(
  tasks: Task[],
  referenceDate: string = today(),
): ProjectProgress {
  const active = tasks.filter((t) => !t.deletedAt);
  const leaves = active.filter(
    (t) => t.kind === "task" && !taskChildren(active, t.id).length,
  );
  const milestones = active.filter((t) => t.kind === "milestone");
  const total = leaves.length,
    completed = leaves.filter((t) => t.status === "Done").length,
    inProgress = leaves.filter((t) => t.status === "In Progress").length,
    overdue = leaves.filter((t) => isOverdue(t, referenceDate)).length;
  const percent = total
    ? Math.round(leaves.reduce((acc, t) => acc + t.progress, 0) / total)
    : 0;
  return {
    percent,
    total,
    completed,
    inProgress,
    overdue,
    milestonesTotal: milestones.length,
    milestonesReached: milestones.filter((m) => m.status === "Done").length,
  };
}

/** Client-side mirror of the SQL cycle check, for instant feedback before the RPC round-trip. */
export function taskDependencyReachable(
  deps: TaskDependency[],
  startId: string,
): Set<string> {
  const ids = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of deps) {
      const from =
        d.predecessorTaskId === startId || ids.has(d.predecessorTaskId);
      if (
        from &&
        d.successorTaskId !== startId &&
        !ids.has(d.successorTaskId)
      ) {
        ids.add(d.successorTaskId);
        changed = true;
      }
    }
  }
  return ids;
}
export function wouldCreateDependencyCycle(
  deps: TaskDependency[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;
  return taskDependencyReachable(deps, successorId).has(predecessorId);
}

/** "At risk": a direct Finish-to-Start predecessor now finishes after this task starts. */
export function hasDependencyConflict(
  task: Task,
  tasksById: Map<string, Task>,
  deps: TaskDependency[],
): boolean {
  return deps.some((d) => {
    if (d.successorTaskId !== task.id || d.type !== "FS") return false;
    const predecessor = tasksById.get(d.predecessorTaskId);
    return !!predecessor && predecessor.endDate > task.startDate;
  });
}

export type VisibleRow = { task: Task; depth: number };

/** DFS row list shared by Task List and Gantt so hierarchy/expand-collapse match exactly. */
export function flattenVisibleTasks(
  tasks: Task[],
  collapsed: Set<string>,
  projectId?: string,
): VisibleRow[] {
  const active = tasks.filter(
    (t) => !t.deletedAt && (!projectId || t.projectId === projectId),
  );
  const out: VisibleRow[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const task of taskChildren(active, parentId)) {
      out.push({ task, depth });
      if (!collapsed.has(task.id)) walk(task.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

/** Min/max date span across a task set, padded a week each side for breathing room. */
export function ganttDateRange(tasks: Task[]): { start: string; end: string } {
  const active = tasks.filter((t) => !t.deletedAt);
  if (!active.length) {
    const t = today();
    return { start: t, end: t };
  }
  const starts = active.map((t) => t.startDate).sort(),
    ends = active.map((t) => t.endDate).sort();
  const pad = (date: string, days: number) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return { start: pad(starts[0], -7), end: pad(ends[ends.length - 1], 7) };
}
