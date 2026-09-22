const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateImageFile(file: File) {
  if (!IMAGE_TYPES.includes(file.type))
    throw new Error("รองรับภาพ PNG, JPEG, WebP และ GIF");
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("ภาพแต่ละไฟล์ต้องไม่เกิน 10 MB");
}

/**
 * Decodes a QR code from an image file, or null when none is found. jsQR's decode tables
 * are ~250KB unminified and only ever needed here, so it's dynamically imported rather than
 * bundled into the app shell every visitor downloads.
 */
export async function decodeQRFromFile(file: File): Promise<string | null> {
  const [{ default: jsQR }, bitmap] = await Promise.all([
    import("jsqr"),
    createImageBitmap(file),
  ]);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return (
      jsQR(imageData.data, imageData.width, imageData.height)?.data || null
    );
  } finally {
    bitmap.close();
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}
