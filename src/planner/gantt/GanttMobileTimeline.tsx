import { Diamond } from "lucide-react";
import { type Task, effectiveProgress, isOverdue, today } from "../model";

/**
 * Native drag-to-resize needs pixel-per-day precision that doesn't work well on touch
 * screens, so mobile gets a simple sorted list instead of the full day-grid Gantt.
 */
export function GanttMobileTimeline({
  projectId,
  tasks,
  onOpenTask,
}: {
  projectId: string;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const rows = tasks
    .filter((t) => !t.deletedAt && t.projectId === projectId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const referenceDate = today();
  return (
    <div className="gantt-mobile-timeline">
      {rows.map((task) => (
        <button
          key={task.id}
          className={`gantt-mobile-row ${isOverdue(task, referenceDate) ? "overdue" : ""}`}
          onClick={() => onOpenTask(task)}
        >
          <div className="gantt-mobile-row-top">
            {task.kind === "milestone" && (
              <Diamond size={12} className="milestone-icon" />
            )}
            <strong>{task.name}</strong>
          </div>
          <div className="muted small">
            {task.startDate} → {task.endDate}
          </div>
          {task.kind === "task" && (
            <span className="task-progress-bar">
              <span
                className="task-progress-fill"
                style={{ width: `${effectiveProgress(tasks, task.id)}%` }}
              />
            </span>
          )}
        </button>
      ))}
      {!rows.length && (
        <div className="empty-list">
          <p>ยังไม่มีงานในโปรเจกต์นี้</p>
        </div>
      )}
    </div>
  );
}
