import { useState } from "react";
import { X, Star } from "lucide-react";
import { Modal } from "../components/Modal";
import {
  createTask,
  saveTask,
  deleteTask,
  addDependency,
  removeDependency,
  toggleTaskFavorite,
} from "./db";
import {
  type Task,
  type TaskDependency,
  type TaskKind,
  TASK_PRIORITIES,
  TASK_STATUSES,
  taskDescendantIds,
  wouldCreateDependencyCycle,
} from "./model";

export function TaskDialog({
  task,
  projectId,
  parentTaskId,
  tasks,
  dependencies,
  onClose,
}: {
  task?: Task;
  projectId: string;
  parentTaskId?: string | null;
  tasks: Task[];
  dependencies: TaskDependency[];
  onClose: () => void;
}) {
  const [kind, setKind] = useState<TaskKind>(task?.kind || "task"),
    [name, setName] = useState(task?.name || ""),
    [description, setDescription] = useState(task?.description || ""),
    [startDate, setStartDate] = useState(task?.startDate || ""),
    [endDate, setEndDate] = useState(task?.endDate || ""),
    [assignee, setAssignee] = useState(task?.assignee || ""),
    [priority, setPriority] = useState(task?.priority || "Medium"),
    [status, setStatus] = useState(task?.status || "To Do"),
    [progress, setProgress] = useState(task?.progress ?? 0),
    [parent, setParent] = useState(task?.parentTaskId || parentTaskId || ""),
    [taskNotes, setTaskNotes] = useState(task?.notes || ""),
    [favorite, setFavorite] = useState(task?.favorite || false),
    [revision, setRevision] = useState(task?.revision ?? 0),
    [predecessor, setPredecessor] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false);
  function toggleFavorite() {
    if (!task) {
      setFavorite((v) => !v);
      return;
    }
    const next = !favorite;
    setFavorite(next);
    toggleTaskFavorite(task.id, next, revision)
      .then((updated) => setRevision(updated.revision))
      .catch((e) => {
        setFavorite(!next);
        setError(e instanceof Error ? e.message : "ปักหมุดไม่สำเร็จ");
      });
  }

  const invalidParents = task
    ? taskDescendantIds(tasks, task.id)
    : new Set<string>();
  const projectTasks = tasks.filter(
    (t) => !t.deletedAt && t.projectId === projectId,
  );
  const predecessorOptions = task
    ? projectTasks.filter(
        (t) =>
          t.id !== task.id &&
          !dependencies.some(
            (d) =>
              d.predecessorTaskId === t.id && d.successorTaskId === task.id,
          ) &&
          !wouldCreateDependencyCycle(dependencies, t.id, task.id),
      )
    : [];
  const ownDependencies = task
    ? dependencies.filter((d) => d.successorTaskId === task.id)
    : [];

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  async function withoutClosing(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={task ? "แก้ไขงาน" : "สร้างงาน"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !startDate) return;
          void run(async () => {
            const input = {
              projectId,
              parentTaskId: parent || null,
              kind,
              name: name.trim(),
              description: description.trim(),
              startDate,
              endDate: kind === "milestone" ? startDate : endDate || startDate,
              assignee: assignee.trim(),
              priority,
              status,
              progress:
                kind === "milestone"
                  ? status === "Done"
                    ? 100
                    : 0
                  : Number(progress),
              notes: taskNotes.trim(),
              favorite,
            };
            if (task) await saveTask({ ...task, ...input }, revision);
            else await createTask(input);
          });
        }}
      >
        <div className="settings-body">
          <div className="segmented" role="radiogroup" aria-label="ประเภทงาน">
            {(["task", "milestone"] as TaskKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? "active" : ""}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k === "task" ? "งาน" : "เหตุการณ์สำคัญ (Milestone)"}
              </button>
            ))}
          </div>
          <div className="dialog-title-row">
            <label className="grow">
              ชื่องาน
              <input
                autoFocus
                value={name}
                maxLength={500}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={`favorite-star icon-button ${favorite ? "active" : ""}`}
              aria-label={favorite ? "เลิกปักหมุด" : "ปักหมุดเป็นรายการโปรด"}
              onClick={toggleFavorite}
            >
              <Star size={16} fill={favorite ? "currentColor" : "none"} />
            </button>
          </div>
          <label>
            รายละเอียด
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="field-row">
            <label>
              วันที่เริ่ม
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            {kind === "task" && (
              <label>
                วันที่สิ้นสุด
                <input
                  type="date"
                  required
                  min={startDate || undefined}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="field-row">
            <label>
              ผู้รับผิดชอบ
              <input
                value={assignee}
                maxLength={200}
                onChange={(e) => setAssignee(e.target.value)}
              />
            </label>
            <label>
              ความสำคัญ
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as Task["priority"])
                }
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label>
              สถานะ
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Task["status"])}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {kind === "task" && (
              <label>
                ความคืบหน้า ({progress}%)
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progress}
                  onChange={(e) => setProgress(Number(e.target.value))}
                />
              </label>
            )}
          </div>
          <label>
            งานหลัก (Parent task)
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">ไม่มี (งานระดับบนสุด)</option>
              {projectTasks
                .filter((t) => !invalidParents.has(t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            บันทึกเพิ่มเติม
            <textarea
              rows={2}
              value={taskNotes}
              onChange={(e) => setTaskNotes(e.target.value)}
            />
          </label>

          {task && (
            <div className="dependency-section">
              <div className="section-kicker">
                งานที่ต้องเสร็จก่อน (Finish-to-Start)
              </div>
              <div className="dependency-chips">
                {ownDependencies.map((d) => {
                  const predecessorTask = tasks.find(
                    (t) => t.id === d.predecessorTaskId,
                  );
                  return (
                    <span key={d.id} className="dependency-chip">
                      {predecessorTask?.name || "ไม่พบงาน"}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="ลบความสัมพันธ์"
                        disabled={busy}
                        onClick={() =>
                          void withoutClosing(() => removeDependency(d.id))
                        }
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
                {!ownDependencies.length && (
                  <small className="muted">ยังไม่มีงานที่ต้องเสร็จก่อน</small>
                )}
              </div>
              {!!predecessorOptions.length && (
                <div className="field-row dependency-picker">
                  <select
                    value={predecessor}
                    onChange={(e) => setPredecessor(e.target.value)}
                  >
                    <option value="">เลือกงานที่ต้องเสร็จก่อน…</option>
                    {predecessorOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !predecessor}
                    onClick={() =>
                      void withoutClosing(async () => {
                        await addDependency(predecessor, task.id, "FS");
                        setPredecessor("");
                      })
                    }
                  >
                    เพิ่ม
                  </button>
                </div>
              )}
            </div>
          )}

          {task && !deleting && (
            <button
              type="button"
              className="danger-text"
              onClick={() => setDeleting(true)}
            >
              ลบงานนี้…
            </button>
          )}
          {deleting && task && (
            <div className="notice column">
              <strong>ลบงานนี้ พร้อมงานย่อยและความสัมพันธ์ที่เกี่ยวข้อง</strong>
              <button
                type="button"
                disabled={busy}
                className="danger"
                onClick={() => run(() => deleteTask(task.id))}
              >
                ยืนยันลบงาน
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || !name.trim() || !startDate}
          >
            บันทึกงาน
          </button>
        </div>
      </form>
    </Modal>
  );
}
