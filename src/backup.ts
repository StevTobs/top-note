import JSZip from "jszip";
import type { JSONContent } from "@tiptap/react";
import { fetchAllNotes, fetchCategories, writeBundle } from "./db";
import { getAssetBlob, listAssets } from "./assets";
import { checkDocument } from "./editor/schema";
import {
  type Category,
  type Note,
  type Asset,
  uid,
  now,
  assetIds,
  textOf,
  safeUrl,
} from "./model";

const allowedNodes = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "summary",
]);
const allowedMarks = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "underline",
  "link",
  "highlight",
]);
export function validateDocument(
  input: unknown,
  depth = 0,
  budget = { nodes: 0 },
): JSONContent {
  if (
    !input ||
    typeof input !== "object" ||
    depth > 30 ||
    ++budget.nodes > 50000
  )
    throw new Error("โครงสร้างเอกสารไม่ถูกต้อง");
  const node = input as JSONContent;
  if (!node.type || !allowedNodes.has(node.type))
    throw new Error("พบชนิดเนื้อหาที่ไม่รองรับ");
  const result: JSONContent = { type: node.type };
  if (node.type === "text") {
    if (typeof node.text !== "string" || !node.text.length)
      throw new Error("ข้อความไม่ถูกต้อง");
    result.text = node.text;
  }
  if (node.content) {
    if (!Array.isArray(node.content)) throw new Error("เนื้อหาไม่ถูกต้อง");
    result.content = node.content.map((c) =>
      validateDocument(c, depth + 1, budget),
    );
  }
  if (node.attrs) {
    const a = node.attrs;
    result.attrs = {};
    if (typeof a.blockId === "string") result.attrs.blockId = a.blockId;
    if (node.type === "heading")
      result.attrs.level = [1, 2, 3].includes(a.level) ? a.level : 2;
    if (node.type === "taskItem") result.attrs.checked = a.checked === true;
    if (node.type === "orderedList")
      result.attrs.start =
        Number.isInteger(a.start) && a.start > 0 ? a.start : 1;
    if (node.type === "codeBlock")
      result.attrs.language =
        typeof a.language === "string" ? a.language : null;
    if (node.type === "image") {
      if (typeof a.assetId !== "string")
        throw new Error("รูปภาพไม่มี asset ID");
      result.attrs = {
        ...result.attrs,
        assetId: a.assetId,
        alt: typeof a.alt === "string" ? a.alt : "",
        caption: typeof a.caption === "string" ? a.caption : "",
        width: Math.max(20, Math.min(100, Number(a.width) || 100)),
        align: a.align === "left" ? "left" : "center",
      };
    }
    if (node.type === "summary")
      result.attrs = {
        ...result.attrs,
        model: typeof a.model === "string" ? a.model : "",
        createdAt: typeof a.createdAt === "string" ? a.createdAt : "",
        mode: a.mode === "replace" ? "replace" : "insert",
        sourceIds: Array.isArray(a.sourceIds)
          ? a.sourceIds.filter((s: unknown) => typeof s === "string")
          : [],
        sourceHash: typeof a.sourceHash === "string" ? a.sourceHash : "",
        sourceFrom: Number.isInteger(a.sourceFrom) ? a.sourceFrom : 0,
        sourceTo: Number.isInteger(a.sourceTo) ? a.sourceTo : 0,
        excludeSummaries: a.excludeSummaries === true,
        stale: a.stale === true,
      };
  }
  if (node.marks) {
    if (!Array.isArray(node.marks)) throw new Error("รูปแบบข้อความไม่ถูกต้อง");
    result.marks = node.marks
      .filter((m) => !!m.type && allowedMarks.has(m.type))
      .flatMap((m) => {
        if (m.type === "link")
          return safeUrl(m.attrs?.href)
            ? [
                {
                  type: "link",
                  attrs: {
                    href: m.attrs!.href,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                },
              ]
            : [];
        if (m.type === "highlight")
          return [
            {
              type: "highlight",
              attrs: {
                color: ["#b7ff3c", "#c4a4ff", "#ffce6b"].includes(
                  m.attrs?.color,
                )
                  ? m.attrs!.color
                  : "#b7ff3c",
              },
            },
          ];
        return [{ type: m.type }];
      });
  }
  return result;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function makeBackup() {
  const [notes, categories, assets] = await Promise.all([
    fetchAllNotes(),
    fetchCategories(),
    listAssets(),
  ]);
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify({
      app: "clever-note",
      version: 1,
      createdAt: now(),
      notes,
      categories,
      assets,
    }),
  );
  // A few downloads at a time: enough to be quick without flooding Storage.
  for (let i = 0; i < assets.length; i += 4) {
    const group = assets.slice(i, i + 4);
    const blobs = await Promise.all(group.map((a) => getAssetBlob(a.id)));
    group.forEach((a, j) => zip.file(`assets/${a.id}`, blobs[j]));
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
export async function importBackup(file: Blob) {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("ไฟล์สำรองต้องไม่เกิน 100 MB");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  // Bound declared uncompressed sizes before allocating archive entries.
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    total +=
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize || 0;
    if (total > 200 * 1024 * 1024)
      throw new Error("ข้อมูลหลังแตกไฟล์ต้องไม่เกิน 200 MB");
  }
  const manifest = zip.file("manifest.json");
  if (!manifest) throw new Error("ไม่พบ manifest.json");
  const raw = await manifest.async("string");
  if (raw.length > 20 * 1024 * 1024) throw new Error("Manifest ใหญ่เกินกำหนด");
  const data = JSON.parse(raw);
  if (
    data.app !== "clever-note" ||
    data.version !== 1 ||
    !Array.isArray(data.notes) ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.assets)
  )
    throw new Error("รูปแบบหรือเวอร์ชันไฟล์สำรองไม่รองรับ");
  if (
    data.notes.length > 10000 ||
    data.categories.length > 10000 ||
    data.assets.length > 10000
  )
    throw new Error("จำนวนรายการเกินกำหนด");
  const ids = new Map<string, string>();
  for (const item of [...data.notes, ...data.categories, ...data.assets]) {
    if (typeof item?.id !== "string" || ids.has(item.id))
      throw new Error("ID ในไฟล์ซ้ำหรือไม่ถูกต้อง");
    ids.set(item.id, uid());
  }
  const root: Category = {
    id: uid(),
    name: `นำเข้า ${new Date().toLocaleDateString("th-TH")}`,
    parentId: null,
    order: Date.now(),
    deletedAt: null,
  };
  const categories: Category[] = data.categories.map((c: Category) => {
    if (typeof c.name !== "string" || c.name.length > 500)
      throw new Error("ชื่อหมวดหมู่ไม่ถูกต้อง");
    if (
      c.parentId &&
      !data.categories.some((x: Category) => x.id === c.parentId)
    )
      throw new Error("ไม่พบหมวดหมู่แม่");
    const seen = new Set<string>();
    let cursor: Category | undefined = c;
    while (cursor) {
      if (seen.has(cursor.id)) throw new Error("หมวดหมู่มีวงจร");
      seen.add(cursor.id);
      cursor = data.categories.find((x: Category) => x.id === cursor?.parentId);
    }
    return {
      id: ids.get(c.id)!,
      name: c.name,
      parentId: c.parentId ? ids.get(c.parentId)! : root.id,
      order: Number(c.order) || 0,
      deletedAt: c.deletedAt ? now() : null,
    };
  });
  const assets: Asset[] = [];
  for (const a of data.assets) {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        a.mimeType,
      ) ||
      !Number.isInteger(a.byteSize) ||
      a.byteSize > 10 * 1024 * 1024 ||
      a.byteSize < 1 ||
      /[\/\\]/.test(a.id)
    )
      throw new Error("รูปภาพใน backup ไม่ถูกต้อง");
    const entry = zip.file(`assets/${a.id}`);
    if (!entry) throw new Error("ไฟล์ภาพไม่ครบ");
    const bytes = await entry.async("arraybuffer");
    if (bytes.byteLength !== a.byteSize)
      throw new Error("ขนาดภาพไม่ตรงกับ manifest");
    assets.push({
      id: ids.get(a.id)!,
      blob: new Blob([bytes], { type: a.mimeType }),
      mimeType: a.mimeType,
      byteSize: bytes.byteLength,
      createdAt: now(),
    });
  }
  const notes: Note[] = data.notes.map((n: Note) => {
    if (typeof n.title !== "string" || n.title.length > 10000)
      throw new Error("ชื่อโน้ตไม่ถูกต้อง");
    const doc = validateDocument(n.document);
    if (doc.type !== "doc") throw new Error("เอกสารต้องเป็น doc");
    try {
      checkDocument(doc);
    } catch {
      throw new Error("โครงสร้างบล็อกในเอกสารไม่ถูกต้อง");
    }
    for (const id of assetIds(doc))
      if (!data.assets.some((a: Asset) => a.id === id))
        throw new Error("โน้ตอ้างอิงภาพที่ไม่มีอยู่");
    const blockMap = new Map<string, string>();
    const walk = (node: JSONContent) => {
      if (node.attrs?.blockId) blockMap.set(node.attrs.blockId, uid());
      node.content?.forEach(walk);
    };
    walk(doc);
    const remap = (node: JSONContent) => {
      if (node.attrs?.blockId)
        node.attrs.blockId = blockMap.get(node.attrs.blockId);
      if (node.type === "image")
        node.attrs!.assetId = ids.get(node.attrs!.assetId);
      if (node.type === "summary")
        node.attrs!.sourceIds = (node.attrs!.sourceIds || [])
          .map((id: string) => blockMap.get(id))
          .filter(Boolean);
      node.content?.forEach(remap);
    };
    remap(doc);
    if (
      n.categoryId &&
      !data.categories.some((c: Category) => c.id === n.categoryId)
    )
      throw new Error("หมวดหมู่ของโน้ตไม่ครบ");
    return {
      id: ids.get(n.id)!,
      categoryId: n.categoryId ? ids.get(n.categoryId)! : root.id,
      title: n.title,
      document: doc,
      plainText: textOf(doc),
      revision: 0,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: n.deletedAt ? now() : null,
    };
  });
  await writeBundle({ categories: [root, ...categories], assets, notes });
  return notes.length;
}
export async function exportMarkdown(note: Note) {
  const zip = new JSZip();
  const escape = (s: string) => s.replace(/[\\`*_{}\[\]<>#|]/g, "\\$&");
  const render = (n: JSONContent): string => {
    if (n.type === "text") {
      let t = escape(n.text || "");
      for (const m of n.marks || []) {
        if (m.type === "bold") t = `**${t}**`;
        if (m.type === "italic") t = `*${t}*`;
        if (m.type === "strike") t = `~~${t}~~`;
        if (m.type === "code")
          t = "`" + (n.text || "").replace(/`/g, "\\`") + "`";
        if (m.type === "link") t = `[${t}](${encodeURI(m.attrs?.href || "")})`;
      }
      return t;
    }
    const content = (n.content || []).map(render).join("");
    switch (n.type) {
      case "heading":
        return `${"#".repeat(n.attrs?.level || 1)} ${content}\n\n`;
      case "paragraph":
        return content + "\n\n";
      case "listItem":
        return "- " + content.trim().replace(/\n/g, "\n  ") + "\n";
      case "taskItem":
        return `- [${n.attrs?.checked ? "x" : " "}] ${content.trim()}\n`;
      case "blockquote":
        return (
          content
            .trim()
            .split("\n")
            .map((l) => "> " + l)
            .join("\n") + "\n\n"
        );
      case "codeBlock":
        return "```\n" + textOf(n) + "\n```\n\n";
      case "image":
        return `![${escape(n.attrs?.alt || "")}](assets/${n.attrs?.assetId})\n\n${n.attrs?.caption || ""}\n\n`;
      case "summary":
        return "> AI SUMMARY\n\n" + content;
      case "hardBreak":
        return "  \n";
      case "horizontalRule":
        return "\n---\n\n";
      default:
        return content;
    }
  };
  zip.file("note.md", `# ${note.title}\n\n${render(note.document)}`);
  for (const id of new Set(assetIds(note.document))) {
    // An image that no longer exists in Storage is skipped; any other failure aborts the export.
    const blob = await getAssetBlob(id).catch((e: Error) => {
      if (/not found/i.test(e.message)) return null;
      throw e;
    });
    if (blob) zip.file(`assets/${id}`, blob);
  }
  return zip.generateAsync({ type: "blob" });
}
