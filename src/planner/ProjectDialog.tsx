import { useState } from "react";
import { Star } from "lucide-react";
import { Modal } from "../components/Modal";
import {
  createProject,
  saveProject,
  deleteProject,
  toggleProjectFavorite,
} from "./db";
import { type Project, PROJECT_STATUSES } from "./model";

export function ProjectDialog({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name || ""),
    [description, setDescription] = useState(project?.description || ""),
    [startDate, setStartDate] = useState(project?.startDate || ""),
    [endDate, setEndDate] = useState(project?.endDate || ""),
    [owner, setOwner] = useState(project?.owner || ""),
    [status, setStatus] = useState(project?.status || "Planning"),
    [favorite, setFavorite] = useState(project?.favorite || false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false);
  function toggleFavorite() {
    setFavorite((v) => !v);
    if (project) void toggleProjectFavorite(project.id, !favorite);
  }
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
  return (
    <Modal
      title={project ? "แก้ไขโปรเจกต์" : "สร้างโปรเจกต์"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            const input = {
              name: name.trim(),
              description: description.trim(),
              startDate: startDate || null,
              endDate: endDate || null,
              owner: owner.trim(),
              status,
            };
            if (project) await saveProject({ ...project, ...input, favorite });
            else await createProject({ ...input, favorite });
          });
        }}
      >
        <div className="settings-body">
          <div className="dialog-title-row">
            <label className="grow">
              ชื่อโปรเจกต์
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
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="field-row">
            <label>
              วันที่เริ่ม
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              วันที่สิ้นสุด
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          <div className="field-row">
            <label>
              เจ้าของโปรเจกต์
              <input
                value={owner}
                maxLength={200}
                placeholder="ชื่อผู้รับผิดชอบ"
                onChange={(e) => setOwner(e.target.value)}
              />
            </label>
            <label>
              สถานะ
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Project["status"])}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {project && !deleting && (
            <button
              type="button"
              className="danger-text"
              onClick={() => setDeleting(true)}
            >
              ลบโปรเจกต์นี้…
            </button>
          )}
          {deleting && project && (
            <div className="notice column">
              <strong>
                ลบโปรเจกต์ พร้อมงานและความสัมพันธ์ทั้งหมดในโปรเจกต์นี้
              </strong>
              <small>การลบนี้ย้อนกลับไม่ได้จากหน้าจอนี้</small>
              <button
                type="button"
                disabled={busy}
                className="danger"
                onClick={() => run(() => deleteProject(project.id))}
              >
                ยืนยันลบโปรเจกต์
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
            disabled={busy || !name.trim()}
          >
            บันทึกโปรเจกต์
          </button>
        </div>
      </form>
    </Modal>
  );
}
