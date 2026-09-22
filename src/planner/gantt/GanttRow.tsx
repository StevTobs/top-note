import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import {
  type Task,
  type TaskDependency,
  effectiveProgress,
  isOverdue,
  hasDependencyConflict,
} from "../model";
import {
  type Zoom,
  PX_PER_DAY,
  ROW_HEIGHT,
  dateToX,
  xToDate,
  daysBetween,
} from "./scale";

type DragMode = "move" | "resize-start" | "resize-end";

export function GanttRow({
  task,
  depth,
  hasChildren,
  isCollapsed,
  onToggleCollapse,
  rangeStart,
  zoom,
  allTasks,
  tasksById,
  dependencies,
  referenceDate,
  onOpenTask,
  onCommitDates,
}: {
  task: Task;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  rangeStart: string;
  zoom: Zoom;
  allTasks: Task[];
  tasksById: Map<string, Task>;
  dependencies: TaskDependency[];
  referenceDate: string;
  onOpenTask: (task: Task) => void;
  onCommitDates: (task: Task, startDate: string, endDate: string) => void;
}) {
  const [preview, setPreview] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const drag = useRef<{
    mode: DragMode;
    startX: number;
    startDate: string;
    endDate: string;
  } | null>(null);

  const effective = preview ?? {
    startDate: task.startDate,
    endDate: task.endDate,
  };
  const x = dateToX(effective.startDate, rangeStart, zoom);
  const width = Math.max(
    PX_PER_DAY[zoom] * 0.6,
    (daysBetween(effective.startDate, effective.endDate) + 1) *
      PX_PER_DAY[zoom],
  );
  const overdue = isOverdue(task, referenceDate);
  const atRisk = hasDependencyConflict(task, tasksById, dependencies);
  const progress = effectiveProgress(allTasks, task.id);
  const milestone = task.kind === "milestone";

  function beginDrag(mode: DragMode) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      drag.current = {
        mode,
        startX: e.clientX,
        startDate: task.startDate,
        endDate: task.endDate,
      };
    };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const deltaDays = Math.round((e.clientX - d.startX) / PX_PER_DAY[zoom]);
    if (!deltaDays && !preview) return;
    if (milestone) {
      const date = xToDate(
        dateToX(d.startDate, rangeStart, zoom) + deltaDays * PX_PER_DAY[zoom],
        rangeStart,
        zoom,
      );
      setPreview({ startDate: date, endDate: date });
      return;
    }
    if (d.mode === "move") {
      setPreview({
        startDate: shiftDate(d.startDate, deltaDays, rangeStart, zoom),
        endDate: shiftDate(d.endDate, deltaDays, rangeStart, zoom),
      });
    } else if (d.mode === "resize-start") {
      const candidate = shiftDate(d.startDate, deltaDays, rangeStart, zoom);
      setPreview({
        startDate: candidate <= d.endDate ? candidate : d.endDate,
        endDate: d.endDate,
      });
    } else {
      const candidate = shiftDate(d.endDate, deltaDays, rangeStart, zoom);
      setPreview({
        startDate: d.startDate,
        endDate: candidate >= d.startDate ? candidate : d.startDate,
      });
    }
  }
  function endDrag() {
    const d = drag.current;
    drag.current = null;
    if (!d || !preview) {
      setPreview(null);
      return;
    }
    if (
      preview.startDate !== task.startDate ||
      preview.endDate !== task.endDate
    ) {
      onCommitDates(task, preview.startDate, preview.endDate);
    }
    setPreview(null);
  }

  return (
    <div
      className={`gantt-row ${overdue ? "overdue" : ""}`}
      style={{ height: ROW_HEIGHT }}
    >
      <div
        className="gantt-label-cell"
        style={{ paddingLeft: 10 + depth * 18 }}
      >
        <span
          role="button"
          tabIndex={-1}
          className="tree-toggle"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleCollapse();
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
        <button className="gantt-label-name" onClick={() => onOpenTask(task)}>
          {task.name}
        </button>
        {atRisk && (
          <span
            className="at-risk-badge"
            title="งานก่อนหน้าล่าช้า อาจกระทบกำหนดการนี้"
          >
            <AlertTriangle size={11} />
          </span>
        )}
      </div>
      <div className="gantt-bar-track">
        {milestone ? (
          <div
            className="gantt-milestone"
            style={{ left: x }}
            onPointerDown={beginDrag("move")}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onClick={() => onOpenTask(task)}
            title={task.name}
          />
        ) : (
          <div
            className="gantt-bar"
            style={{ left: x, width }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          >
            <div
              className="gantt-bar-handle gantt-bar-handle-start"
              onPointerDown={beginDrag("resize-start")}
            />
            <div
              className="gantt-bar-body"
              onPointerDown={beginDrag("move")}
              onClick={() => onOpenTask(task)}
            >
              <div
                className="gantt-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div
              className="gantt-bar-handle gantt-bar-handle-end"
              onPointerDown={beginDrag("resize-end")}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function shiftDate(
  date: string,
  deltaDays: number,
  rangeStart: string,
  zoom: Zoom,
): string {
  return xToDate(
    dateToX(date, rangeStart, zoom) + deltaDays * PX_PER_DAY[zoom],
    rangeStart,
    zoom,
  );
}
