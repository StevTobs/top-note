import { useState } from "react";
import { Pencil, UserPlus, X } from "lucide-react";
import { addMember, removeMember } from "./db";
import {
  type Project,
  type Task,
  type ProjectMember,
  projectProgress,
} from "./model";

export function ProjectOverviewView({
  project,
  tasks,
  members,
  onEdit,
  onError,
}: {
  project: Project;
  tasks: Task[];
  members: ProjectMember[];
  onEdit: () => void;
  onError: (message: string) => void;
}) {
  const [memberName, setMemberName] = useState(""),
    [memberRole, setMemberRole] = useState(""),
    [busy, setBusy] = useState(false);
  const projectTasks = tasks.filter(
    (t) => !t.deletedAt && t.projectId === project.id,
  );
  const progress = projectProgress(projectTasks);
  const projectMembers = members.filter((m) => m.projectId === project.id);

  async function addMemberRow() {
    if (!memberName.trim()) return;
    setBusy(true);
    try {
      await addMember(project.id, memberName.trim(), memberRole.trim());
      setMemberName("");
      setMemberRole("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "เพิ่มสมาชิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-overview">
      <div className="overview-header-card">
        <div>
          <div className="section-kicker">{project.status.toUpperCase()}</div>
          <h2>{project.name}</h2>
          {project.description && (
            <p className="muted">{project.description}</p>
          )}
          <div className="overview-meta">
            <span>เจ้าของ: {project.owner || "—"}</span>
            <span>
              กำหนดการ: {project.startDate || "—"} → {project.endDate || "—"}
            </span>
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="แก้ไขโปรเจกต์"
          onClick={onEdit}
        >
          <Pencil size={17} />
        </button>
      </div>

      <div className="stat-tiles">
        <div className="stat-tile">
          <strong>{progress.percent}%</strong>
          <span>ความคืบหน้ารวม</span>
        </div>
        <div className="stat-tile">
          <strong>{progress.total}</strong>
          <span>งานทั้งหมด</span>
        </div>
        <div className="stat-tile">
          <strong>{progress.completed}</strong>
          <span>เสร็จแล้ว</span>
        </div>
        <div className="stat-tile">
          <strong>{progress.inProgress}</strong>
          <span>กำลังดำเนินการ</span>
        </div>
        <div className="stat-tile warn">
          <strong>{progress.overdue}</strong>
          <span>เลยกำหนด</span>
        </div>
        <div className="stat-tile">
          <strong>
            {progress.milestonesReached}/{progress.milestonesTotal}
          </strong>
          <span>เหตุการณ์สำคัญ</span>
        </div>
      </div>

      <div className="overview-team">
        <div className="section-kicker">ทีมงาน (Team)</div>
        <div className="member-list">
          {projectMembers.map((m) => (
            <span key={m.id} className="dependency-chip">
              {m.name}
              {m.role && <small className="muted"> · {m.role}</small>}
              <button
                type="button"
                className="icon-button"
                aria-label={`ลบ ${m.name}`}
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      await removeMember(m.id);
                    } catch (e) {
                      onError(
                        e instanceof Error ? e.message : "ลบสมาชิกไม่สำเร็จ",
                      );
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {!projectMembers.length && (
            <small className="muted">ยังไม่มีสมาชิกในทีม</small>
          )}
        </div>
        <div className="field-row member-add-row">
          <input
            placeholder="ชื่อสมาชิก"
            value={memberName}
            maxLength={200}
            onChange={(e) => setMemberName(e.target.value)}
          />
          <input
            placeholder="บทบาท (ไม่บังคับ)"
            value={memberRole}
            maxLength={200}
            onChange={(e) => setMemberRole(e.target.value)}
          />
          <button
            disabled={busy || !memberName.trim()}
            onClick={() => void addMemberRow()}
          >
            <UserPlus size={14} />
            เพิ่ม
          </button>
        </div>
      </div>
    </div>
  );
}
