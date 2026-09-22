import { fail, supabase, currentUserId } from "../supabase";
import { pages, findUserIdByEmail } from "../db";
import { uid, now } from "../model";
import {
  getStore,
  setStore,
  upsertProject,
  removeProject,
  upsertTask,
  removeTask,
} from "../store";
import {
  type Project,
  type ProjectStatus,
  type Task,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
  type TaskDependency,
  type DependencyType,
  type ProjectMember,
  type ProjectShare,
} from "./model";

// ─── Row mapping (snake_case Postgres ⇄ camelCase app model) ────────────────

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  owner: string;
  status: ProjectStatus;
  sort_order: number;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type ProjectShareRow = {
  id: string;
  project_id: string;
  owner_id: string;
  owner_email: string;
  shared_with_user_id: string;
  shared_with_email: string;
  created_at: string;
};
type TaskRow = {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  kind: TaskKind;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  assignee: string;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  notes: string;
  sort_order: number;
  is_favorite: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type DependencyRow = {
  id: string;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: DependencyType;
  created_at: string;
};
type MemberRow = {
  id: string;
  project_id: string;
  name: string;
  role: string;
  created_at: string;
};

const PROJECT_COLUMNS =
  "id, user_id, name, description, start_date, end_date, owner, status, sort_order, is_favorite, created_at, updated_at, deleted_at";
const TASK_COLUMNS =
  "id, project_id, parent_task_id, kind, name, description, start_date, end_date, assignee, priority, status, progress, notes, sort_order, is_favorite, revision, created_at, updated_at, deleted_at";
const DEPENDENCY_COLUMNS =
  "id, predecessor_task_id, successor_task_id, dependency_type, created_at";
const MEMBER_COLUMNS = "id, project_id, name, role, created_at";
const PROJECT_SHARE_COLUMNS =
  "id, project_id, owner_id, owner_email, shared_with_user_id, shared_with_email, created_at";

// Timestamps are normalised to toISOString() for the same reason as src/db.ts: Postgres
// trims trailing zeros, which would otherwise break lexical sort/comparison.
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  ownerId: r.user_id,
  name: r.name,
  description: r.description,
  startDate: r.start_date,
  endDate: r.end_date,
  owner: r.owner,
  status: r.status,
  order: Number(r.sort_order),
  favorite: r.is_favorite,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  deletedAt: iso(r.deleted_at),
});
const projectRow = (p: Project) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  start_date: p.startDate,
  end_date: p.endDate,
  owner: p.owner,
  status: p.status,
  sort_order: Number(p.order) || 0,
  is_favorite: p.favorite,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
  deleted_at: p.deletedAt,
});

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  projectId: r.project_id,
  parentTaskId: r.parent_task_id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  startDate: r.start_date,
  endDate: r.end_date,
  assignee: r.assignee,
  priority: r.priority,
  status: r.status,
  progress: Number(r.progress),
  notes: r.notes,
  order: Number(r.sort_order),
  favorite: r.is_favorite,
  revision: r.revision,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  deletedAt: iso(r.deleted_at),
});
const taskRow = (t: Task) => ({
  id: t.id,
  project_id: t.projectId,
  parent_task_id: t.parentTaskId,
  kind: t.kind,
  name: t.name,
  description: t.description,
  start_date: t.startDate,
  end_date: t.endDate,
  assignee: t.assignee,
  priority: t.priority,
  status: t.status,
  progress: Number(t.progress) || 0,
  notes: t.notes,
  sort_order: Number(t.order) || 0,
  is_favorite: t.favorite,
  revision: t.revision,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  deleted_at: t.deletedAt,
});

const toDependency = (r: DependencyRow): TaskDependency => ({
  id: r.id,
  predecessorTaskId: r.predecessor_task_id,
  successorTaskId: r.successor_task_id,
  type: r.dependency_type,
  createdAt: iso(r.created_at)!,
});

const toMember = (r: MemberRow): ProjectMember => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  role: r.role,
  createdAt: iso(r.created_at)!,
});
const toProjectShare = (r: ProjectShareRow): ProjectShare => ({
  id: r.id,
  projectId: r.project_id,
  ownerId: r.owner_id,
  ownerEmail: r.owner_email,
  sharedWithUserId: r.shared_with_user_id,
  sharedWithEmail: r.shared_with_email,
  createdAt: iso(r.created_at)!,
});

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const rows = await pages<ProjectRow>(
    (a, b) =>
      supabase
        .from("projects")
        .select(PROJECT_COLUMNS)
        .order("sort_order")
        .order("id")
        .range(a, b),
    "โหลดโปรเจกต์ไม่สำเร็จ",
  );
  return rows.map(toProject);
}
export async function fetchTasks(): Promise<Task[]> {
  const rows = await pages<TaskRow>(
    (a, b) =>
      supabase
        .from("tasks")
        .select(TASK_COLUMNS)
        .order("sort_order")
        .order("id")
        .range(a, b),
    "โหลดงานไม่สำเร็จ",
  );
  return rows.map(toTask);
}
export async function fetchDependencies(): Promise<TaskDependency[]> {
  const rows = await pages<DependencyRow>(
    (a, b) =>
      supabase
        .from("task_dependencies")
        .select(DEPENDENCY_COLUMNS)
        .order("id")
        .range(a, b),
    "โหลดความสัมพันธ์งานไม่สำเร็จ",
  );
  return rows.map(toDependency);
}
export async function fetchMembers(): Promise<ProjectMember[]> {
  const rows = await pages<MemberRow>(
    (a, b) =>
      supabase
        .from("project_members")
        .select(MEMBER_COLUMNS)
        .order("id")
        .range(a, b),
    "โหลดสมาชิกโปรเจกต์ไม่สำเร็จ",
  );
  return rows.map(toMember);
}

export async function refreshProjects() {
  setStore({ projects: await fetchProjects() });
}
export async function refreshTasks() {
  setStore({ tasks: await fetchTasks() });
}
export async function refreshDependencies() {
  setStore({ dependencies: await fetchDependencies() });
}
export async function refreshMembers() {
  setStore({ members: await fetchMembers() });
}

/** Loaded lazily the first time the user opens Planning mode, not part of note loading. */
export async function loadPlanner() {
  const [projects, tasks, dependencies, members, mySharedProjects] =
    await Promise.all([
      fetchProjects(),
      fetchTasks(),
      fetchDependencies(),
      fetchMembers(),
      fetchMySharedProjects(),
    ]);
  setStore({
    plannerLoaded: true,
    projects,
    tasks,
    dependencies,
    members,
    mySharedProjects,
  });
}

// ─── Sharing (edit access, only for users who have already signed in) ───────

/** All shares granted to me, for "แชร์โดย …" badges in the project list. */
export async function fetchMySharedProjects(): Promise<ProjectShare[]> {
  const rows = await pages<ProjectShareRow>(
    (a, b) =>
      supabase.from("project_shares").select(PROJECT_SHARE_COLUMNS).range(a, b),
    "โหลดรายการที่แชร์ไม่สำเร็จ",
  );
  return rows.map(toProjectShare);
}

/** Owner-side: who currently has access to this project. */
export async function fetchProjectShares(
  projectId: string,
): Promise<ProjectShare[]> {
  const { data, error } = await supabase
    .from("project_shares")
    .select(PROJECT_SHARE_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw fail(error, "โหลดรายชื่อผู้เข้าถึงไม่สำเร็จ");
  return (data as ProjectShareRow[]).map(toProjectShare);
}

export async function shareProject(
  projectId: string,
  inviteeEmail: string,
): Promise<ProjectShare> {
  const sharedWithUserId = await findUserIdByEmail(inviteeEmail);
  if (!sharedWithUserId)
    throw new Error("ไม่พบผู้ใช้นี้ ต้องเป็นคนที่เคยเข้าสู่ระบบมาก่อน");
  if (sharedWithUserId === (await currentUserId()))
    throw new Error("แชร์ให้ตัวเองไม่ได้");
  // owner_id/owner_email/shared_with_email are never sent: owner_id defaults to auth.uid()
  // and a server-side trigger fills both emails from auth.users, so the client can't spoof
  // either display string (see supabase/migrations/0004_sharing.sql).
  const row = {
    id: uid(),
    project_id: projectId,
    shared_with_user_id: sharedWithUserId,
  };
  const { data, error } = await supabase
    .from("project_shares")
    .insert(row)
    .select(PROJECT_SHARE_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error("แชร์ให้คนนี้ไปแล้ว");
    throw fail(error, "แชร์โปรเจกต์ไม่สำเร็จ");
  }
  if (!data) throw new Error("แชร์โปรเจกต์ไม่สำเร็จ");
  return toProjectShare(data as ProjectShareRow);
}

export async function unshareProject(shareId: string) {
  const { error } = await supabase
    .from("project_shares")
    .delete()
    .eq("id", shareId);
  if (error) throw fail(error, "ยกเลิกการแชร์ไม่สำเร็จ");
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function createProject(input: {
  name: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
  owner?: string;
  status?: ProjectStatus;
  favorite?: boolean;
}): Promise<Project> {
  const project: Project = {
    id: uid(),
    ownerId: await currentUserId(),
    name: input.name,
    description: input.description ?? "",
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    owner: input.owner ?? "",
    status: input.status ?? "Planning",
    order: Date.now(),
    favorite: input.favorite ?? false,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  const { error } = await supabase.from("projects").insert(projectRow(project));
  if (error) throw fail(error, "สร้างโปรเจกต์ไม่สำเร็จ");
  upsertProject(project);
  return project;
}

/** Projects are edited rarely via a single form, same tier as categories: no revision guard. */
export async function saveProject(project: Project): Promise<Project> {
  const next = { ...project, updatedAt: now() };
  const { error } = await supabase
    .from("projects")
    .update({
      name: next.name,
      description: next.description,
      start_date: next.startDate,
      end_date: next.endDate,
      owner: next.owner,
      status: next.status,
      updated_at: next.updatedAt,
    })
    .eq("id", next.id);
  if (error) throw fail(error, "บันทึกโปรเจกต์ไม่สำเร็จ");
  upsertProject(next);
  return next;
}

/** Persists a drag-to-reorder drop among sibling projects. No revision on this table. */
export async function reorderProject(id: string, order: number) {
  const { error } = await supabase
    .from("projects")
    .update({ sort_order: order })
    .eq("id", id);
  if (error) throw fail(error, "จัดลำดับโปรเจกต์ไม่สำเร็จ");
  const project = getStore().projects.find((p) => p.id === id);
  if (project) upsertProject({ ...project, order });
}

export async function toggleProjectFavorite(id: string, favorite: boolean) {
  const { error } = await supabase
    .from("projects")
    .update({ is_favorite: favorite })
    .eq("id", id);
  if (error) throw fail(error, "ปักหมุดโปรเจกต์ไม่สำเร็จ");
  const project = getStore().projects.find((p) => p.id === id);
  if (project) upsertProject({ ...project, favorite });
}

export async function deleteProject(id: string) {
  const { error } = await supabase.rpc("delete_project", { p_id: id });
  if (error) throw fail(error, "ลบโปรเจกต์ไม่สำเร็จ");
  removeProject(id);
  await Promise.all([refreshTasks(), refreshDependencies(), refreshMembers()]);
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

const TASK_CONFLICT = "งานเปลี่ยนจากอีกหน้าต่าง กรุณาโหลดใหม่แล้วลองอีกครั้ง";

export async function createTask(input: {
  projectId: string;
  parentTaskId?: string | null;
  kind?: TaskKind;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  assignee?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  progress?: number;
  notes?: string;
  favorite?: boolean;
}): Promise<Task> {
  const task: Task = {
    id: uid(),
    projectId: input.projectId,
    parentTaskId: input.parentTaskId ?? null,
    kind: input.kind ?? "task",
    name: input.name,
    description: input.description ?? "",
    startDate: input.startDate,
    endDate: input.kind === "milestone" ? input.startDate : input.endDate,
    assignee: input.assignee ?? "",
    priority: input.priority ?? "Medium",
    status: input.status ?? "To Do",
    progress: input.progress ?? 0,
    notes: input.notes ?? "",
    order: Date.now(),
    favorite: input.favorite ?? false,
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  const { error } = await supabase.from("tasks").insert(taskRow(task));
  if (error) throw fail(error, "สร้างงานไม่สำเร็จ");
  upsertTask(task);
  return task;
}

/**
 * Optimistic concurrency, identical in shape to saveNote: the update only matches while the
 * stored revision is still the one the caller last saw, so a Gantt drag from another tab or
 * device can never be silently overwritten. Shared by TaskDialog and the Gantt drag-end handler.
 */
export async function saveTask(
  task: Task,
  expectedRevision: number,
): Promise<Task> {
  const updatedAt = now();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      ...taskRow(task),
      revision: expectedRevision + 1,
      updated_at: updatedAt,
    })
    .eq("id", task.id)
    .eq("revision", expectedRevision)
    .select("revision, updated_at")
    .maybeSingle();
  if (error) throw fail(error, "บันทึกงานไม่สำเร็จ");
  if (!data) throw new Error(TASK_CONFLICT);
  const next = { ...task, revision: data.revision as number, updatedAt };
  upsertTask(next);
  return next;
}

/** Narrow patch (e.g. Kanban drag), mirrors patchNote. */
export async function patchTaskStatus(
  id: string,
  status: TaskStatus,
  expectedRevision: number,
): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .update({ status, revision: expectedRevision + 1, updated_at: now() })
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) throw fail(error, "อัปเดตสถานะงานไม่สำเร็จ");
  if (!data) throw new Error(TASK_CONFLICT);
  const task = toTask(data as TaskRow);
  upsertTask(task);
  return task;
}

/** Persists a drag-to-reorder drop; same revision guard as saveTask/patchTaskStatus. */
export async function reorderTask(
  id: string,
  order: number,
  expectedRevision: number,
): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .update({
      sort_order: order,
      revision: expectedRevision + 1,
      updated_at: now(),
    })
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) throw fail(error, "จัดลำดับงานไม่สำเร็จ");
  if (!data) throw new Error(TASK_CONFLICT);
  const task = toTask(data as TaskRow);
  upsertTask(task);
  return task;
}

export async function toggleTaskFavorite(
  id: string,
  favorite: boolean,
  expectedRevision: number,
): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .update({
      is_favorite: favorite,
      revision: expectedRevision + 1,
      updated_at: now(),
    })
    .eq("id", id)
    .eq("revision", expectedRevision)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) throw fail(error, "ปักหมุดงานไม่สำเร็จ");
  if (!data) throw new Error(TASK_CONFLICT);
  const task = toTask(data as TaskRow);
  upsertTask(task);
  return task;
}

export async function deleteTask(id: string) {
  const { error } = await supabase.rpc("delete_task", { p_id: id });
  if (error) throw fail(error, "ลบงานไม่สำเร็จ");
  await Promise.all([refreshTasks(), refreshDependencies()]);
}

// ─── Dependencies ────────────────────────────────────────────────────────────

export async function addDependency(
  predecessorId: string,
  successorId: string,
  type: DependencyType = "FS",
) {
  const { error } = await supabase.rpc("add_task_dependency", {
    p_id: uid(),
    p_predecessor_id: predecessorId,
    p_successor_id: successorId,
    p_type: type,
  });
  if (error) {
    if (/dependency_cycle/.test(error.message))
      throw new Error("ทำให้เกิดความสัมพันธ์วนซ้ำ ไม่สามารถเพิ่มได้");
    if (/dependency_cross_project/.test(error.message))
      throw new Error("เชื่อมโยงได้เฉพาะงานในโปรเจกต์เดียวกัน");
    if (/dependency_self/.test(error.message))
      throw new Error("งานเดียวกันเชื่อมโยงตัวเองไม่ได้");
    if (/dependency_task_missing/.test(error.message))
      throw new Error("ไม่พบงานที่ต้องการเชื่อมโยง");
    throw fail(error, "เพิ่มความสัมพันธ์งานไม่สำเร็จ");
  }
  await refreshDependencies();
}
export async function removeDependency(id: string) {
  const { error } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("id", id);
  if (error) throw fail(error, "ลบความสัมพันธ์งานไม่สำเร็จ");
  setStore({
    dependencies: getStore().dependencies.filter((d) => d.id !== id),
  });
}

// ─── Project members (free-text labels; see BLUEPRINT decision, no real cross-account sharing) ───

export async function addMember(
  projectId: string,
  name: string,
  role: string,
): Promise<ProjectMember> {
  const member: ProjectMember = {
    id: uid(),
    projectId,
    name,
    role,
    createdAt: now(),
  };
  const { error } = await supabase.from("project_members").insert({
    id: member.id,
    project_id: member.projectId,
    name: member.name,
    role: member.role,
    created_at: member.createdAt,
  });
  if (error) throw fail(error, "เพิ่มสมาชิกไม่สำเร็จ");
  setStore({ members: [...getStore().members, member] });
  return member;
}
export async function removeMember(id: string) {
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("id", id);
  if (error) throw fail(error, "ลบสมาชิกไม่สำเร็จ");
  setStore({ members: getStore().members.filter((m) => m.id !== id) });
}
