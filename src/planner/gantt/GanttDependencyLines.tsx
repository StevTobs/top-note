import type { Task, TaskDependency, VisibleRow } from "../model";
import { type Zoom, ROW_HEIGHT, dateToX } from "./scale";

export function GanttDependencyLines({
  rows,
  dependencies,
  rangeStart,
  zoom,
  width,
}: {
  rows: VisibleRow[];
  dependencies: TaskDependency[];
  rangeStart: string;
  zoom: Zoom;
  width: number;
}) {
  const indexById = new Map(rows.map((r, i) => [r.task.id, i]));
  const taskById = new Map(rows.map((r) => [r.task.id, r.task]));
  const height = rows.length * ROW_HEIGHT;

  const paths = dependencies
    .map((d) => {
      const from = taskById.get(d.predecessorTaskId),
        to = taskById.get(d.successorTaskId);
      const fromIndex = indexById.get(d.predecessorTaskId),
        toIndex = indexById.get(d.successorTaskId);
      if (!from || !to || fromIndex === undefined || toIndex === undefined)
        return null;
      return elbowPath(from, to, fromIndex, toIndex, rangeStart, zoom);
    })
    .filter((p): p is string => !!p);

  if (!height || !paths.length) return null;
  return (
    <svg className="gantt-dependency-svg" width={width} height={height}>
      <defs>
        <marker
          id="gantt-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--purple)" />
        </marker>
      </defs>
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          className="gantt-dependency-path"
          markerEnd="url(#gantt-arrow)"
        />
      ))}
    </svg>
  );
}

function elbowPath(
  from: Task,
  to: Task,
  fromIndex: number,
  toIndex: number,
  rangeStart: string,
  zoom: Zoom,
): string {
  const y1 = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
    y2 = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x1 = dateToX(from.endDate, rangeStart, zoom),
    x2 = dateToX(to.startDate, rangeStart, zoom);
  const mid = x1 + Math.max(10, (x2 - x1) / 2);
  return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
}
