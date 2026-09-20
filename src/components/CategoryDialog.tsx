import { useState } from "react";
import { Modal } from "./Modal";
import { addCategory, moveCategory, deleteCategory } from "../db";
import { getStore } from "../store";
import { type Category, descendants, categoryPath } from "../model";
export function CategoryDialog({
  category,
  parentId,
  categories,
  onClose,
  beforeChange,
}: {
  category?: Category;
  parentId: string | null;
  categories: Category[];
  onClose: () => void;
  beforeChange: () => Promise<void>;
}) {
  const [name, setName] = useState(category?.name || ""),
    [parent, setParent] = useState(category?.parentId || parentId || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false),
    [trash, setTrash] = useState(false),
    [count, setCount] = useState(0);
  const invalid = category
    ? descendants(categories, category.id)
    : new Set<string>();
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await beforeChange();
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
      title={category ? "จัดการหมวดหมู่" : "สร้างหมวดหมู่"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            if (category)
              await moveCategory(category.id, parent || null, name.trim());
            else await addCategory(name.trim(), parent || null);
          });
        }}
      >
        <div className="settings-body">
          <label>
            ชื่อหมวดหมู่
            <input
              autoFocus
              value={name}
              maxLength={100}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            อยู่ภายใต้
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">ระดับบนสุด</option>
              {categories
                .filter((c) => !c.deletedAt && !invalid.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryPath(categories, c.id)}
                  </option>
                ))}
            </select>
          </label>
          {category && !deleting && (
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                setCount(
                  getStore().notes.filter(
                    (n) =>
                      !!n.categoryId && invalid.has(n.categoryId) && !n.deletedAt,
                  ).length,
                );
                setDeleting(true);
              }}
            >
              ลบหมวดหมู่นี้…
            </button>
          )}
          {deleting && category && (
            <div className="notice column">
              <strong>
                ลบหมวดและหมวดย่อย รวม {invalid.size} หมวด / {count} โน้ต
              </strong>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={trash}
                  onChange={(e) => setTrash(e.target.checked)}
                />
                ย้ายโน้ตทั้งหมดเข้าถังขยะด้วย
              </label>
              <small>หากไม่เลือก โน้ตทั้งหมดจะย้ายไป Inbox</small>
              <button
                type="button"
                disabled={busy}
                className="danger"
                onClick={() => run(() => deleteCategory(category.id, trash))}
              >
                ยืนยันลบหมวดหมู่
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
            บันทึกหมวดหมู่
          </button>
        </div>
      </form>
    </Modal>
  );
}
