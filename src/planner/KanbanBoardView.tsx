import { useState } from "react";
import { Diamond, Star } from "lucide-react";
import { patchTaskStatus, reorderTask, toggleTaskFavorite } from "./db";
import { dropOrder } from "../ordering";
import {
  TASK_STATUSES,
  type Task,
  type TaskStatus,
  isOverdue,
  today,
} from "./model";

export function KanbanBoardView({
  projectId,
  tasks,
  onOpenTask,
  onError,
}: {
  projectId: string;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onError: (message: string) => void;
}) {
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const projectTasks = tasks.filter(
    (t) => !t.deletedAt && t.projectId === projectId,
  );
  const tasksById = new Map(projectTasks.map((t) => [t.id, t]));
  const referenceDate = today();

  /** Dropped on a column's empty area (or past its last card): move status, append at the end. */
  async function dropOnColumn(status: TaskStatus, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const task = tasksById.get(id);
    if (!task) return;
    try {
      if (task.status !== status)
        await patchTaskStatus(task.id, status, task.revision);
    } catch (err) {
      onError(err instanceof Error ? err.message : "อัปเดตสถานะงานไม่สำเร็จ");
    }
  }

  /** Dropped on a specific card: reorder within that card's column (and move status if needed). */
  async function dropOnCard(
    status: TaskStatus,
    target: Task,
    e: React.DragEvent,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    setDragOverCardId(null);
    const id = e.dataTransfer.getData("text/plain");
    const dragged = tasksById.get(id);
    if (!dragged || dragged.id === target.id) return;
    try {
      if (dragged.status !== status)
        await patchTaskStatus(dragged.id, status, dragged.revision);
      const column = projectTasks
        .filter((t) => t.status === status && t.id !== dragged.id)
        .sort((a, b) => a.order - b.order)
        .map((t) => ({ id: t.id, order: t.order }));
      const order = await dropOrder(column, target.id, (cid, o) => {
        const t = tasksById.get(cid);
        return t ? reorderTask(cid, o, t.revision) : Promise.resolve();
      });
      const fresh = tasksById.get(dragged.id) ?? dragged;
      await reorderTask(dragged.id, order, fresh.revision);
    } catch (err) {
      onError(err instanceof Error ? err.message : "จัดลำดับงานไม่สำเร็จ");
    }
  }

  return (
    <div className="kanban-board">
      {TASK_STATUSES.map((status) => (
        <div
          key={status}
          className={`kanban-column ${dragOver === status ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(status);
          }}
          onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
          onDrop={(e) => void dropOnColumn(status, e)}
        >
          <div className="kanban-column-head">
            <span>{status}</span>
            <span className="kanban-count">
              {projectTasks.filter((t) => t.status === status).length}
            </span>
          </div>
          <div className="kanban-cards">
            {projectTasks
              .filter((t) => t.status === status)
              .sort(
                (a, b) =>
                  Number(b.favorite) - Number(a.favorite) || a.order - b.order,
              )
              .map((task) => {
                const parent = task.parentTaskId
                  ? tasksById.get(task.parentTaskId)
                  : null;
                return (
                  <button
                    key={task.id}
                    className={`kanban-card ${isOverdue(task, referenceDate) ? "overdue" : ""} ${dragOverCardId === task.id ? "drag-over" : ""}`}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", task.id)
                    }
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverCardId(task.id);
                    }}
                    onDragLeave={() =>
                      setDragOverCardId((id) => (id === task.id ? null : id))
                    }
                    onDrop={(e) => void dropOnCard(status, task, e)}
                    onClick={() => onOpenTask(task)}
                  >
                    <div className="kanban-card-top">
                      {task.kind === "milestone" && (
                        <Diamond size={11} className="milestone-icon" />
                      )}
                      <span
                        className={`badge priority-${task.priority.toLowerCase()}`}
                      >
                        {task.priority}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
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
                          size={12}
                          fill={task.favorite ? "currentColor" : "none"}
                        />
                      </span>
                    </div>
                    <strong>{task.name}</strong>
                    {parent && (
                      <span className="kanban-parent-chip">
                        ส่วนหนึ่งของ: {parent.name}
                      </span>
                    )}
                    {task.assignee && (
                      <small className="muted">{task.assignee}</small>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
