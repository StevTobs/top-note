import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Diamond,
  Plus,
  AlertTriangle,
  Star,
} from "lucide-react";
import { reorderTask, toggleTaskFavorite } from "./db";
import { dropOrder } from "../ordering";
import {
  type Task,
  type TaskDependency,
  flattenVisibleTasks,
  taskChildren,
  effectiveProgress,
  isOverdue,
  hasDependencyConflict,
  today,
} from "./model";

export function TaskListView({
  projectId,
  tasks,
  dependencies,
  collapsed,
  onToggleCollapse,
  onOpenTask,
  onNewTask,
}: {
  projectId: string;
  tasks: Task[];
  dependencies: TaskDependency[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onOpenTask: (task: Task) => void;
  onNewTask: (parentTaskId: string | null) => void;
}) {
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const projectTasks = tasks.filter(
    (t) => !t.deletedAt && t.projectId === projectId,
  );
  const rows = flattenVisibleTasks(tasks, collapsed, projectId).filter(
    (r) => !favoritesOnly || r.task.favorite,
  );
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const referenceDate = today();

  async function drop(targetTask: Task, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData("text/plain");
    setDragOverId(null);
    const dragged = projectTasks.find((t) => t.id === draggedId);
    if (
      !dragged ||
      draggedId === targetTask.id ||
      dragged.parentTaskId !== targetTask.parentTaskId
    )
      return;
    const siblings = taskChildren(projectTasks, targetTask.parentTaskId)
      .filter((t) => t.id !== draggedId)
      .map((t) => ({ id: t.id, order: t.order }));
    const order = await dropOrder(siblings, targetTask.id, (id, o) => {
      const t = projectTasks.find((x) => x.id === id);
      return t ? reorderTask(id, o, t.revision) : Promise.resolve();
    });
    await reorderTask(draggedId, order, dragged.revision);
  }

  return (
    <div className="task-list-view">
      <div className="view-toolbar">
        <button className="primary" onClick={() => onNewTask(null)}>
          <Plus size={15} />
          เพิ่มงาน
        </button>
        <label className="check-label">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => setFavoritesOnly(e.target.checked)}
          />
          แสดงเฉพาะรายการโปรด
        </label>
      </div>
      <div className="task-table">
        <div className="task-table-head">
          <span>ชื่องาน</span>
          <span>ผู้รับผิดชอบ</span>
          <span>ความสำคัญ</span>
          <span>สถานะ</span>
          <span>กำหนดการ</span>
          <span>ความคืบหน้า</span>
        </div>
        {rows.map(({ task, depth }) => {
          const hasChildren = !!taskChildren(tasks, task.id).length,
            isCollapsed = collapsed.has(task.id),
            overdue = isOverdue(task, referenceDate),
            atRisk = hasDependencyConflict(task, tasksById, dependencies);
          return (
            <div
              key={task.id}
              className={`task-row ${overdue ? "overdue" : ""} ${dragOverId === task.id ? "drag-over" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpenTask(task)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenTask(task);
                }
              }}
              style={{ paddingLeft: 10 + depth * 18 }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(task.id);
              }}
              onDragLeave={() =>
                setDragOverId((id) => (id === task.id ? null : id))
              }
              onDrop={(e) => void drop(task, e)}
            >
              <span className="task-row-name">
                <span
                  role="button"
                  tabIndex={-1}
                  className="tree-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (hasChildren) onToggleCollapse(task.id);
                  }}
                >
                  {hasChildren ? (
                    isCollapsed ? (
                      <ChevronRight size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )
                  ) : (
                    <span className="tree-dot" />
                  )}
                </span>
                {task.kind === "milestone" && (
                  <Diamond size={12} className="milestone-icon" />
                )}
                <span className="task-row-title">{task.name}</span>
                {atRisk && (
                  <span
                    className="at-risk-badge"
                    title="งานก่อนหน้าล่าช้า อาจกระทบกำหนดการนี้"
                  >
                    <AlertTriangle size={12} />
                  </span>
                )}
                <button
                  className={`favorite-star icon-button ${task.favorite ? "active" : ""}`}
                  aria-label={
                    task.favorite
                      ? `เลิกปักหมุด ${task.name}`
                      : `ปักหมุด ${task.name}`
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleTaskFavorite(
                      task.id,
                      !task.favorite,
                      task.revision,
                    );
                  }}
                >
                  <Star
                    size={13}
                    fill={task.favorite ? "currentColor" : "none"}
                  />
                </button>
              </span>
              <span className="muted small">{task.assignee || "—"}</span>
              <span>
                <span
                  className={`badge priority-${task.priority.toLowerCase()}`}
                >
                  {task.priority}
                </span>
              </span>
              <span>
                <span
                  className={`badge status-${task.status.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {task.status}
                </span>
              </span>
              <span className="muted small">
                {task.startDate} → {task.endDate}
              </span>
              <span className="task-progress-cell">
                <span className="task-progress-bar">
                  <span
                    className="task-progress-fill"
                    style={{ width: `${effectiveProgress(tasks, task.id)}%` }}
                  />
                </span>
                <small>{effectiveProgress(tasks, task.id)}%</small>
              </span>
            </div>
          );
        })}
        {!rows.length && (
          <div className="empty-list">
            <p>ยังไม่มีงานในโปรเจกต์นี้</p>
          </div>
        )}
      </div>
    </div>
  );
}
