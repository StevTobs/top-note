import { Extension, Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import { useEffect, useState } from "react";
import { getAssetBlob } from "../assets";
import { hashText, uid } from "../model";
import { scopeText } from "./scope";

const blockTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "horizontalRule",
  "image",
  "summary",
];
export const BlockIds = Extension.create({
  name: "blockIds",
  addGlobalAttributes() {
    return [
      {
        types: blockTypes,
        attributes: {
          blockId: {
            default: null,
            parseHTML: () => null,
            renderHTML: (attrs) => ({ "data-block-id": attrs.blockId }),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr,
            seen = new Set<string>();
          state.doc.descendants((node, pos) => {
            if (blockTypes.includes(node.type.name)) {
              const id = node.attrs.blockId;
              if (!id || seen.has(id))
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  blockId: uid(),
                });
              else seen.add(id);
            }
          });
          return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});

function ImageView({
  node,
  updateAttributes,
  selected,
  editor,
}: NodeViewProps) {
  const [src, setSrc] = useState(""),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = "",
      cancelled = false;
    setSrc("");
    setFailed(false);
    getAssetBlob(node.attrs.assetId)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [node.attrs.assetId]);
  return (
    <NodeViewWrapper
      className={`image-block ${selected ? "selected" : ""}`}
      contentEditable={false}
    >
      <figure
        style={{
          width: `${node.attrs.width}%`,
          marginLeft: node.attrs.align === "left" ? 0 : "auto",
          marginRight: "auto",
        }}
      >
        {src ? (
          <img src={src} alt={node.attrs.alt || ""} draggable={false} />
        ) : (
          <div className="asset-placeholder">
            {failed ? "โหลดรูปภาพไม่สำเร็จ" : "กำลังโหลดรูปภาพ…"}
          </div>
        )}
        {node.attrs.caption && <figcaption>{node.attrs.caption}</figcaption>}
      </figure>
      {selected && editor.isEditable && (
        <div className="image-controls">
          <label>
            ความกว้าง{" "}
            <input
              aria-label="ความกว้างรูปภาพ"
              type="range"
              min="20"
              max="100"
              value={node.attrs.width}
              onChange={(e) =>
                updateAttributes({ width: Number(e.target.value) })
              }
            />
          </label>
          <select
            aria-label="จัดตำแหน่งรูปภาพ"
            value={node.attrs.align}
            onChange={(e) => updateAttributes({ align: e.target.value })}
          >
            <option value="center">กึ่งกลาง</option>
            <option value="left">ชิดซ้าย</option>
          </select>
          <input
            aria-label="คำบรรยายภาพ"
            placeholder="คำบรรยายภาพ"
            value={node.attrs.caption}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
          />
          <input
            aria-label="ข้อความทดแทนภาพ"
            placeholder="ข้อความทดแทนภาพ (alt)"
            value={node.attrs.alt}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}
export const LocalImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
      width: { default: 100 },
      align: { default: "center" },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-local-image": "true" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
function SummaryView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="summary-block">
      <div className="summary-label" contentEditable={false}>
        <span>✦ AI SUMMARY</span>
        <small>
          {node.attrs.model} ·{" "}
          {node.attrs.createdAt
            ? new Date(node.attrs.createdAt).toLocaleString("th-TH")
            : ""}
        </small>
      </div>
      {node.attrs.stale && node.attrs.mode === "insert" && (
        <div className="stale-label" contentEditable={false}>
          ต้นฉบับมีการแก้ไข
        </div>
      )}
      <NodeViewContent className="summary-content" />
    </NodeViewWrapper>
  );
}
export const Summary = Node.create({
  name: "summary",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      model: { default: "" },
      createdAt: { default: "" },
      sourceIds: { default: [] },
      sourceHash: { default: "" },
      sourceFrom: { default: 0 },
      sourceTo: { default: 0 },
      excludeSummaries: { default: false },
      mode: { default: "insert" },
      stale: { default: false },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { "data-summary": "true" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SummaryView);
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, old, state) {
          if (
            !transactions.some((t) => t.docChanged) ||
            transactions.some((t) => t.getMeta("summary-map"))
          )
            return null;
          const oldIds = new Set<string>();
          old.doc.descendants((n) => {
            if (n.type.name === "summary") oldIds.add(n.attrs.blockId);
          });
          const tr = state.tr;
          state.doc.descendants((n, pos) => {
            if (
              n.type.name !== "summary" ||
              n.attrs.mode !== "insert" ||
              !oldIds.has(n.attrs.blockId)
            )
              return;
            let from = n.attrs.sourceFrom,
              to = n.attrs.sourceTo;
            for (const t of transactions) {
              from = t.mapping.map(from, 1);
              to = t.mapping.map(to, -1);
            }
            from = Math.max(0, Math.min(from, state.doc.content.size));
            to = Math.max(from, Math.min(to, state.doc.content.size));
            const stale =
              n.attrs.stale ||
              hashText(
                scopeText(state.doc, from, to, n.attrs.excludeSummaries),
              ) !== n.attrs.sourceHash;
            if (
              from !== n.attrs.sourceFrom ||
              to !== n.attrs.sourceTo ||
              stale !== n.attrs.stale
            )
              tr.setNodeMarkup(pos, undefined, {
                ...n.attrs,
                sourceFrom: from,
                sourceTo: to,
                stale,
              });
          });
          return tr.docChanged
            ? tr.setMeta("summary-map", true).setMeta("addToHistory", false)
            : null;
        },
      }),
    ];
  },
});
