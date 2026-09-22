import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  LayoutDashboard,
  ListTodo,
  Kanban,
  ChartGantt,
  Menu,
  X,
} from "lucide-react";
import { loadPlanner } from "./db";
import { useStore } from "../store";
import type { Project, Task } from "./model";
import { ProjectList } from "./ProjectList";
import { ProjectDialog } from "./ProjectDialog";
import { ProjectOverviewView } from "./ProjectOverviewView";
import { TaskListView } from "./TaskListView";
import { TaskDialog } from "./TaskDialog";
import { KanbanBoardView } from "./KanbanBoardView";
import { GanttChartView } from "./gantt/GanttChartView";
import { GanttMobileTimeline } from "./gantt/GanttMobileTimeline";

type View = "overview" | "list" | "board" | "gantt";
const VIEWS: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "ภาพรวม", icon: LayoutDashboard },
  { id: "list", label: "รายการงาน", icon: ListTodo },
  { id: "board", label: "Kanban", icon: Kanban },
  { id: "gantt", label: "Gantt Chart", icon: ChartGantt },
];

export function Planner({
  session,
  onExit,
}: {
  session: Session;
  onExit: () => void;
}) {
  const { plannerLoaded, projects, tasks, dependencies, members } = useStore();
  const [fatal, setFatal] = useState(""),
    [error, setError] = useState(""),
    [view, setView] = useState<View>("overview"),
    [selectedProjectId, setSelectedProjectId] = useState<string | null>(null),
    [mobilePage, setMobilePage] = useState<"projects" | "detail">("projects"),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [projectDialog, setProjectDialog] = useState<{ project?: Project } | null>(
      null,
    ),
    [taskDialog, setTaskDialog] = useState<{
      task?: Task;
      parentTaskId?: string | null;
    } | null>(null);

  useEffect(() => {
    if (plannerLoaded) return;
    loadPlanner().catch((e) =>
      setFatal(e instanceof Error ? e.message : String(e)),
    );
  }, [plannerLoaded]);

  const activeProjects = projects.filter((p) => !p.deletedAt);
  useEffect(() => {
    if (!selectedProjectId && activeProjects.length)
      setSelectedProjectId(activeProjects[0].id);
  }, [activeProjects, selectedProjectId]);
  const project =
    activeProjects.find((p) => p.id === selectedProjectId) || null;

  function selectProject(id: string) {
    setSelectedProjectId(id);
    setMobilePage("detail");
  }
  function openTask(task: Task) {
    setTaskDialog({ task });
  }
  function newTask(parentTaskId: string | null) {
    setTaskDialog({ parentTaskId });
  }

  if (fatal)
    return (
      <div className="boot">
        <h1>โหลดข้อมูลโปรเจกต์ไม่ได้</h1>
        <p>{fatal}</p>
        <button onClick={onExit}>กลับไปหน้าโน้ต</button>
      </div>
    );
  if (!plannerLoaded)
    return (
      <div className="boot">
        <div className="brand-mark">
          P<span>▰</span>
        </div>
        <p>กำลังโหลดโปรเจกต์…</p>
      </div>
    );

  return (
    <div className={`app planner-mode mobile-${mobilePage}`}>
      <header className="app-header">
        <button className="brand planner-back" onClick={onExit}>
          <span className="icon-button">
            <ArrowLeft size={18} />
          </span>
          <span>
            PROJECT<span className="brand-light">PLANNING</span>
            <small>PLAN. TRACK. DELIVER.</small>
          </span>
        </button>
      </header>
      <div className="workspace">
        <ProjectList
          projects={activeProjects}
          selectedId={selectedProjectId}
          onSelect={selectProject}
          onCreate={() => setProjectDialog({})}
        />
        <section className="planner-main">
          {project ? (
            <>
              <div className="planner-main-head">
                <button
                  className="mobile-menu"
                  onClick={() => setMobilePage("projects")}
                >
                  <Menu size={15} />
                  โปรเจกต์
                </button>
                <div className="view-tabs">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      className={view === v.id ? "active" : ""}
                      onClick={() => setView(v.id)}
                    >
                      <v.icon size={14} />
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="planner-view-body">
                {view === "overview" && (
                  <ProjectOverviewView
                    project={project}
                    tasks={tasks}
                    members={members}
                    onEdit={() => setProjectDialog({ project })}
                    onError={setError}
                  />
                )}
                {view === "list" && (
                  <TaskListView
                    projectId={project.id}
                    tasks={tasks}
                    dependencies={dependencies}
                    collapsed={collapsed}
                    onToggleCollapse={(id) =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        next.has(id) ? next.delete(id) : next.add(id);
                        return next;
                      })
                    }
                    onOpenTask={openTask}
                    onNewTask={newTask}
                  />
                )}
                {view === "board" && (
                  <KanbanBoardView
                    projectId={project.id}
                    tasks={tasks}
                    onOpenTask={openTask}
                    onError={setError}
                  />
                )}
                {view === "gantt" && (
                  <>
                    <div className="gantt-desktop-only">
                      <GanttChartView
                        projectId={project.id}
                        tasks={tasks}
                        dependencies={dependencies}
                        onOpenTask={openTask}
                        onNewTask={newTask}
                        onError={setError}
                      />
                    </div>
                    <div className="gantt-mobile-only">
                      <GanttMobileTimeline
                        projectId={project.id}
                        tasks={tasks}
                        onOpenTask={openTask}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="empty-workspace">
              <div className="abstract-emblem">
                <div />
                <span>02</span>
              </div>
              <div className="section-kicker">PLAN. TRACK. DELIVER.</div>
              <h2>เริ่มโปรเจกต์แรกของคุณ</h2>
              <p>
                สร้างโปรเจกต์เพื่อแบ่งงานเป็นขั้นตอน กำหนดเวลา
                และติดตามความคืบหน้า
              </p>
              <button className="primary" onClick={() => setProjectDialog({})}>
                สร้างโปรเจกต์ใหม่
              </button>
            </div>
          )}
        </section>
      </div>
      {projectDialog && (
        <ProjectDialog
          project={projectDialog.project}
          onClose={() => setProjectDialog(null)}
        />
      )}
      {taskDialog && project && (
        <TaskDialog
          task={taskDialog.task}
          projectId={project.id}
          parentTaskId={taskDialog.parentTaskId}
          tasks={tasks}
          dependencies={dependencies}
          onClose={() => setTaskDialog(null)}
        />
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="ปิดข้อความแจ้งเตือน"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
