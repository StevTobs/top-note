// Locks owned by this tab. Category dialogs flush its active editor before mutations.
export const ownedNoteLocks = new Set<string>();

export async function withNoteLocks<T>(
  ids: string[],
  action: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return action();
  const pending = [...new Set(ids)]
    .filter((id) => !ownedNoteLocks.has(id))
    .sort();
  async function acquire(index: number): Promise<T> {
    if (index === pending.length) return action();
    return navigator.locks.request(
      `clever-note:${pending[index]}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error(
            "มีโน้ตในหมวดนี้กำลังเปิดแก้ไขในอีกแท็บ กรุณาปิดโน้ตนั้นก่อนลบหมวดหมู่",
          );
        return acquire(index + 1);
      },
    );
  }
  return acquire(0);
}
