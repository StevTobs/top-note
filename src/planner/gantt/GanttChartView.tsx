import { useState } from "react";
import { Plus } from "lucide-react";
import { saveTask } from "../db";
import {
  type Task,
  type TaskDependency,
  flattenVisibleTasks,
  ganttDateRange,
  taskChildren,
  today,
} from "../model";
import { GanttRow } from "./GanttRow";
import { GanttDependencyLines } from "./GanttDependencyLines";
import {
  type Zoom,
  PX_PER_DAY,
  ROW_HEIGHT,
  dateToX,
  addDays,
  daysBetween,
} from "./scale";

const ZOOMS: { id: Zoom; label: string }[] = [
  { id: "day", label: "วัน" },
  { id: "week", label: "สัปดาห์" },
  { id: "month", label: "เดือน" },
];

function ganttTicks(rangeStart: string, rangeEnd: string, zoom: Zoom) {
  const stepDays = zoom === "day" ? 1 : zoom === "week" ? 7 : 30;
  const total = daysBetween(rangeStart, rangeEnd);
  const ticks: { date: string; x: number; label: string }[] = [];
  for (let d = 0; d <= total; d += stepDays) {
    const date = addDays(rangeStart, d);
    const label = new Date(date + "T00:00:00Z").toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      ...(zoom === "day"
        ? {}
        : { year: zoom === "month" ? "2-digit" : undefined }),
    });
    ticks.push({ date, x: d * PX_PER_DAY[zoom], label });
  }
  return ticks;
}

export function GanttChartView({
  projectId,
  tasks,
  dependencies,
  onOpenTask,
  onNewTask,
  onError,
}: {
  projectId: string;
  tasks: Task[];
  dependencies: TaskDependency[];
  onOpenTask: (task: Task) => void;
  onNewTask: (parentTaskId: string | null) => void;
  onError: (message: string) => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("day");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const projectTasks = tasks.filter(
    (t) => !t.deletedAt && t.projectId === projectId,
  );
  const rows = flattenVisibleTasks(projectTasks, collapsed);
  const { start: rangeStart, end: rangeEnd } = ganttDateRange(projectTasks);
  const ticks = ganttTicks(rangeStart, rangeEnd, zoom);
  const timelineWidth = daysBetween(rangeStart, rangeEnd) * PX_PER_DAY[zoom];
  const tasksById = new Map(projectTasks.map((t) => [t.id, t]));
  const referenceDate = today();
  const todayX = dateToX(referenceDate, rangeStart, zoom);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function commitDates(task: Task, startDate: string, endDate: string) {
    try {
      await saveTask({ ...task, startDate, endDate }, task.revision);
    } catch (e) {
      onError(e instanceof Error ? e.message : "บันทึกกำหนดการไม่สำเร็จ");
    }
  }

  return (
    <div className="gantt-chart-view">
      <div className="view-toolbar">
        <button className="primary" onClick={() => onNewTask(null)}>
          <Plus size={15} />
          เพิ่มงาน
        </button>
        <div className="segmented">
          {ZOOMS.map((z) => (
            <button
              key={z.id}
              className={zoom === z.id ? "active" : ""}
              aria-pressed={zoom === z.id}
              onClick={() => setZoom(z.id)}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <div className="empty-list">
          <p>ยังไม่มีงานในโปรเจกต์นี้</p>
        </div>
      ) : (
        <div className="gantt-scroll">
          <div className="gantt-inner">
            <div className="gantt-header-row">
              <div className="gantt-label-cell gantt-label-head">ชื่องาน</div>
              <div className="gantt-ruler" style={{ width: timelineWidth }}>
                {ticks.map((t) => (
                  <span
                    key={t.date}
                    className="gantt-tick"
                    style={{ left: t.x }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
            <div
              className="gantt-body"
              style={{ height: rows.length * ROW_HEIGHT }}
            >
              {rows.map(({ task, depth }) => (
                <GanttRow
                  key={task.id}
                  task={task}
                  depth={depth}
                  hasChildren={!!taskChildren(projectTasks, task.id).length}
                  isCollapsed={collapsed.has(task.id)}
                  onToggleCollapse={() => toggleCollapse(task.id)}
                  rangeStart={rangeStart}
                  zoom={zoom}
                  allTasks={projectTasks}
                  tasksById={tasksById}
                  dependencies={dependencies}
                  referenceDate={referenceDate}
                  onOpenTask={onOpenTask}
                  onCommitDates={commitDates}
                />
              ))}
              <div
                className="gantt-today-line"
                style={{ left: `calc(var(--gantt-label-width) + ${todayX}px)` }}
              />
              <div
                className="gantt-dependency-overlay"
                style={{ left: "var(--gantt-label-width)" }}
              >
                <GanttDependencyLines
                  rows={rows}
                  dependencies={dependencies}
                  rangeStart={rangeStart}
                  zoom={zoom}
                  width={timelineWidth}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
