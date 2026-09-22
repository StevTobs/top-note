import { useState } from "react";
import { FolderKanban, Plus, Star } from "lucide-react";
import { reorderProject, toggleProjectFavorite } from "./db";
import { dropOrder } from "../ordering";
import type { Project } from "./model";

export function ProjectList({
  projects,
  selectedId,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const active = projects
    .filter((p) => !p.deletedAt)
    .sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order,
    );

  async function drop(targetId: string | null, e: React.DragEvent) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const siblings = active
      .filter((p) => p.id !== draggedId)
      .map((p) => ({ id: p.id, order: p.order }));
    const order = await dropOrder(siblings, targetId, reorderProject);
    await reorderProject(draggedId, order);
  }

  return (
    <aside className="sidebar planner-sidebar">
      <button className="new-note primary" onClick={onCreate}>
        <Plus size={18} />
        สร้างโปรเจกต์ใหม่<small>↗</small>
      </button>
      <nav aria-label="โปรเจกต์">
        <div className="nav-heading">
          <span>PROJECTS</span>
        </div>
        {active.map((p) => (
          <div
            key={p.id}
            className={`nav-item-row ${dragOverId === p.id ? "drag-over" : ""}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverId(p.id);
            }}
            onDragLeave={() => setDragOverId((id) => (id === p.id ? null : id))}
            onDrop={(e) => void drop(p.id, e)}
          >
            <button
              className={`nav-item ${selectedId === p.id ? "selected" : ""}`}
              onClick={() => onSelect(p.id)}
            >
              <FolderKanban size={16} />
              <span className="nav-item-label">{p.name}</span>
            </button>
            <button
              className={`favorite-star icon-button ${p.favorite ? "active" : ""}`}
              aria-label={
                p.favorite ? `เลิกปักหมุด ${p.name}` : `ปักหมุด ${p.name}`
              }
              onClick={() => void toggleProjectFavorite(p.id, !p.favorite)}
            >
              <Star size={13} fill={p.favorite ? "currentColor" : "none"} />
            </button>
          </div>
        ))}
        {!active.length && (
          <p className="muted small sidebar-hint">
            เริ่มต้นด้วยการสร้างโปรเจกต์แรกของคุณ
          </p>
        )}
      </nav>
    </aside>
  );
}
