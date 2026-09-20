import { ASSET_BUCKET, currentUserId, fail, supabase } from "./supabase";
import { type Asset, uid, now } from "./model";

export const ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

// Downloaded images are kept for the session so the editor never refetches a picture
// it has already shown (undo/redo and re-renders remount the image view).
const blobs = new Map<string, Promise<Blob>>();
export const clearAssetCache = () => blobs.clear();

export type AssetMeta = Omit<Asset, "blob">;

type AssetRow = {
  id: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
};
const toMeta = (r: AssetRow): AssetMeta => ({
  id: r.id,
  mimeType: r.mime_type,
  byteSize: r.byte_size,
  createdAt: new Date(r.created_at).toISOString(),
});

/**
 * Uploads bytes to Storage, then records metadata. Rolls the object back if the row fails.
 * `skipExisting` makes the call idempotent (used by the local-data migration): an image that
 * is already in the cloud is left untouched instead of being overwritten or reported as an error.
 */
export async function putAsset(asset: Asset, { skipExisting = false } = {}) {
  if (!ASSET_TYPES.includes(asset.mimeType))
    throw new Error("รองรับภาพ PNG, JPEG, WebP และ GIF");
  if (asset.byteSize > MAX_ASSET_BYTES)
    throw new Error("ภาพแต่ละไฟล์ต้องไม่เกิน 10 MB");
  const path = `${await currentUserId()}/${asset.id}`;
  const up = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(path, asset.blob, { contentType: asset.mimeType, upsert: false });
  const existed =
    !!up.error &&
    skipExisting &&
    /already exists|duplicate/i.test(up.error.message);
  if (up.error && !existed) throw fail(up.error, "อัปโหลดภาพไม่สำเร็จ");
  const row = {
    id: asset.id,
    mime_type: asset.mimeType,
    byte_size: asset.byteSize,
    created_at: asset.createdAt,
  };
  const { error } = skipExisting
    ? await supabase
        .from("assets")
        .upsert(row, { onConflict: "id", ignoreDuplicates: true })
    : await supabase.from("assets").insert(row);
  if (error) {
    if (!existed) await supabase.storage.from(ASSET_BUCKET).remove([path]);
    throw fail(error, "บันทึกข้อมูลภาพไม่สำเร็จ");
  }
  blobs.set(asset.id, Promise.resolve(asset.blob));
}

export async function uploadImage(file: File): Promise<string> {
  const id = uid();
  await putAsset({
    id,
    blob: file,
    mimeType: file.type,
    byteSize: file.size,
    createdAt: now(),
  });
  return id;
}

export function getAssetBlob(id: string): Promise<Blob> {
  let hit = blobs.get(id);
  if (!hit) {
    hit = (async () => {
      const { data, error } = await supabase.storage
        .from(ASSET_BUCKET)
        .download(`${await currentUserId()}/${id}`);
      if (error || !data) throw fail(error, "โหลดภาพไม่สำเร็จ");
      return data;
    })();
    // A failed download must not be cached, so a later render can retry.
    hit.catch(() => blobs.delete(id));
    blobs.set(id, hit);
  }
  return hit;
}

export async function listAssets(): Promise<AssetMeta[]> {
  const out: AssetMeta[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("assets")
      .select("id, mime_type, byte_size, created_at")
      .order("id")
      .range(from, from + 999);
    if (error) throw fail(error, "โหลดรายการภาพไม่สำเร็จ");
    out.push(...(data as AssetRow[]).map(toMeta));
    if (data.length < 1000) return out;
  }
}

export async function removeAssetObjects(ids: string[]) {
  if (!ids.length) return;
  const userId = await currentUserId();
  const { error } = await supabase.storage
    .from(ASSET_BUCKET)
    .remove(ids.map((id) => `${userId}/${id}`));
  ids.forEach((id) => blobs.delete(id));
  if (error) throw fail(error, "ลบไฟล์ภาพไม่สำเร็จ");
}

export async function removeAssetRows(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("assets").delete().in("id", ids);
  if (error) throw fail(error, "ลบข้อมูลภาพไม่สำเร็จ");
}
