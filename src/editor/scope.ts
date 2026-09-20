import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
export type Scope = {
  from: number;
  to: number;
  replaceFrom: number;
  insertAt: number;
  text: string;
  signature: string;
  images: boolean;
  fullBlocks: boolean;
  sourceIds: string[];
  section: boolean;
  stale: boolean;
};
export function scopeText(
  doc: PMNode,
  from: number,
  to: number,
  excludeSummaries = false,
): string {
  const parts: string[] = [];
  doc.nodesBetween(from, to, (n, pos) => {
    if (excludeSummaries && n.type.name === "summary") return false;
    if (n.isText)
      parts.push(
        (n.text || "").slice(
          Math.max(0, from - pos),
          Math.max(0, Math.min(n.nodeSize, to - pos)),
        ),
      );
    else if (n.type.name === "image") {
      if (n.attrs.caption) parts.push(n.attrs.caption);
    } else if (n.isBlock && parts.length) parts.push("\n");
    else if (n.type.name === "hardBreak") parts.push("\n");
  });
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function signature(doc: PMNode, from: number, to: number): string {
  return JSON.stringify(doc.slice(from, to).toJSON());
}
export function captureScope(
  editor: Editor,
  kind: "selection" | "block" | "section",
  headingPos?: number,
): Scope {
  const { doc, selection } = editor.state;
  let { from, to } = selection;
  let replaceFrom = from;
  if (kind === "block") {
    const depth = selection.$from.depth;
    if (!depth) throw new Error("วางเคอร์เซอร์ในข้อความก่อน");
    from = selection.$from.before(1);
    to = selection.$to.depth ? selection.$to.after(1) : selection.to;
    replaceFrom = from;
  }
  if (kind === "section") {
    let start = headingPos ?? -1;
    if (start < 0)
      doc.forEach((n, pos) => {
        if (pos <= selection.from && n.type.name === "heading") start = pos;
      });
    const heading = start >= 0 ? doc.nodeAt(start) : null;
    if (!heading || heading.type.name !== "heading")
      throw new Error("วางเคอร์เซอร์ใต้หัวข้อ หรือเลือกหัวข้อจากสารบัญ");
    from = start;
    to = doc.content.size;
    replaceFrom = start + heading.nodeSize;
    doc.forEach((n, pos) => {
      if (
        pos > start &&
        pos < to &&
        n.type.name === "heading" &&
        n.attrs.level <= heading.attrs.level
      )
        to = pos;
    });
  }
  if (from === to) throw new Error("เลือกข้อความก่อน แล้วกดสรุปส่วนนี้");
  const text = scopeText(doc, from, to, kind === "section");
  if (!text.trim()) throw new Error("ส่วนที่เลือกไม่มีข้อความให้สรุป");
  let images = false;
  const sourceIds: string[] = [];
  doc.nodesBetween(from, to, (n) => {
    if (n.type.name === "image" || n.type.name === "horizontalRule")
      images = true;
    if (n.attrs.blockId) sourceIds.push(n.attrs.blockId);
  });
  const $from = doc.resolve(from),
    $to = doc.resolve(to);
  const fullBlocks =
    kind !== "selection" || ($from.depth === 0 && $to.depth === 0);
  const insertAt = $to.depth > 0 ? $to.after(1) : to;
  return {
    from,
    to,
    replaceFrom,
    insertAt,
    text,
    signature: signature(doc, from, to),
    images,
    fullBlocks,
    sourceIds,
    section: kind === "section",
    stale: false,
  };
}
