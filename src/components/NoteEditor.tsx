import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { closeHistory } from "@tiptap/pm/history";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  ImagePlus,
  List,
  ListOrdered,
  ListChecks,
  Undo2,
  Redo2,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  Download,
  X,
  Copy,
  ArrowDownToLine,
  Replace,
  ListTree,
  ChevronLeft,
  Quote,
  Minus,
} from "lucide-react";
import {
  type Note,
  type Category,
  type Preferences,
  uid,
  now,
  textOf,
  hashText,
  categoryPath,
  safeUrl,
} from "../model";
import { fetchNote, saveNote } from "../db";
import { uploadImage } from "../assets";
import { documentExtensions } from "../editor/schema";
import { type Scope, captureScope, signature } from "../editor/scope";
import { summarize } from "../ai";
import { download, exportMarkdown } from "../backup";
import { Modal } from "./Modal";
import { ownedNoteLocks } from "../locks";

type Props = {
  note: Note;
  /** Latest revision the server list reports; a higher number means another device saved. */
  remoteRevision: number;
  categories: Category[];
  preferences: Preferences;
  apiKey: string;
  onSettings: () => void;
  focus: boolean;
  toggleFocus: () => void;
  onBack: () => void;
  flushRef: MutableRefObject<() => Promise<void>>;
  onSaveStatus: (status: string) => void;
  onError: (message: string) => void;
};
export function NoteEditor({
  note,
  remoteRevision,
  categories,
  preferences,
  apiKey,
  onSettings,
  focus,
  toggleFocus,
  onBack,
  flushRef,
  onSaveStatus,
  onError,
}: Props) {
  const [title, setTitle] = useState(note.title),
    [writable, setWritable] = useState(false),
    [lockStatus, setLockStatus] = useState("กำลังเปิดโน้ต…"),
    [version, setVersion] = useState(0),
    [aiOpen, setAiOpen] = useState(false),
    [scope, setScope] = useState<Scope | null>(null),
    [result, setResult] = useState(""),
    [resultModel, setResultModel] = useState(""),
    [aiError, setAiError] = useState(""),
    [busy, setBusy] = useState(false),
    [format, setFormat] = useState("bullet points"),
    [length, setLength] = useState("short"),
    [language, setLanguage] = useState("Thai"),
    [toc, setToc] = useState(false),
    [linkOpen, setLinkOpen] = useState(false),
    [linkValue, setLinkValue] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [slash, setSlash] = useState(false);
  const draft = useRef(note),
    dirty = useRef(false),
    generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saving = useRef<Promise<void> | null>(null),
    alive = useRef(true),
    writableRef = useRef(false),
    release = useRef<(() => void) | null>(null),
    channel = useRef<BroadcastChannel | null>(null),
    scopeRef = useRef<Scope | null>(null),
    request = useRef<AbortController | null>(null),
    fileRef = useRef<HTMLInputElement>(null),
    editorRef = useRef<ReturnType<typeof useEditor>>(null),
    generationAI = useRef(0);
  const callbacks = useRef({ onError, onSaveStatus });
  callbacks.current = { onError, onSaveStatus };

  async function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current;
    if (!dirty.current) return;
    const job = (async () => {
      while (dirty.current) {
        const seq = generation.current,
          snapshot = { ...draft.current };
        try {
          const saved = await saveNote(snapshot, snapshot.revision);
          draft.current = {
            ...draft.current,
            revision: saved.revision,
            updatedAt: saved.updatedAt,
          };
          if (seq === generation.current) dirty.current = false;
          if (alive.current)
            callbacks.current.onSaveStatus(
              dirty.current ? "กำลังบันทึก…" : "บันทึกแล้ว",
            );
        } catch (e) {
          if (alive.current) {
            callbacks.current.onSaveStatus("บันทึกไม่สำเร็จ");
            callbacks.current.onError(
              e instanceof Error
                ? e.message
                : "พื้นที่จัดเก็บอาจเต็ม กรุณาส่งออกสำเนาโน้ต",
            );
          }
          throw e;
        }
      }
    })();
    saving.current = job;
    try {
      await job;
    } finally {
      if (saving.current === job) saving.current = null;
    }
  }
  const flushLatest = useRef(flush);
  flushLatest.current = flush;
  function change(patch: Partial<Note>) {
    if (!writableRef.current) return;
    draft.current = { ...draft.current, ...patch };
    generation.current++;
    dirty.current = true;
    onSaveStatus("กำลังบันทึก…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushLatest.current().catch(() => {});
    }, 500);
  }

  async function addImages(files: File[]) {
    const current = editorRef.current;
    if (!current || !writableRef.current) return;
    const insertAt = current.state.selection.to;
    try {
      const images: JSONContent[] = [];
      for (const file of files) {
        if (
          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            file.type,
          )
        )
          throw new Error("รองรับภาพ PNG, JPEG, WebP และ GIF");
        if (file.size > 10 * 1024 * 1024)
          throw new Error("ภาพแต่ละไฟล์ต้องไม่เกิน 10 MB");
        const decoded = await createImageBitmap(file);
        decoded.close();
        const id = await uploadImage(file);
        images.push({
          type: "image",
          attrs: {
            assetId: id,
            alt: file.name,
            caption: "",
            width: 100,
            align: "center",
            blockId: uid(),
          },
        });
      }
      if (alive.current && writableRef.current)
        current
          .chain()
          .focus()
          .insertContentAt(
            Math.min(insertAt, current.state.doc.content.size),
            images,
          )
          .run();
    } catch (e) {
      onError(e instanceof Error ? e.message : "เพิ่มภาพไม่สำเร็จ");
    }
  }
  const editor = useEditor({
    extensions: [
      ...documentExtensions(),
      Placeholder.configure({
        placeholder: "เขียนสิ่งที่อยู่ในหัว… หรือพิมพ์ / เพื่อเพิ่มเนื้อหา",
      }),
    ],
    content: note.document,
    editable: false,
    editorProps: {
      attributes: {
        class: "note-prose",
        role: "textbox",
        "aria-label": "เนื้อหาโน้ต",
        "aria-multiline": "true",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length) {
          event.preventDefault();
          void addImages(files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length) {
          event.preventDefault();
          void addImages(files);
          return true;
        }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest("a");
        if (a && (event.ctrlKey || event.metaKey)) {
          const href = a.getAttribute("href");
          if (href && safeUrl(href))
            window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      change({ document: e.getJSON(), plainText: e.getText() });
      const { $from } = e.state.selection;
      setSlash($from.parent.textContent === "/");
    },
    onTransaction: ({ transaction, editor: e }) => {
      setVersion((v) => v + 1);
      const current = scopeRef.current;
      if (current && transaction.docChanged) {
        const updated = {
          ...current,
          from: transaction.mapping.map(current.from, 1),
          to: transaction.mapping.map(current.to, -1),
          replaceFrom: transaction.mapping.map(current.replaceFrom, 1),
          insertAt: transaction.mapping.map(current.insertAt, -1),
        };
        try {
          updated.stale =
            current.stale ||
            updated.from > updated.to ||
            signature(e.state.doc, updated.from, updated.to) !==
              current.signature;
        } catch {
          updated.stale = true;
        }
        scopeRef.current = updated;
        setScope(updated);
      }
    },
  });
  editorRef.current = editor;

  function setAccess(value: boolean) {
    writableRef.current = value;
    if (alive.current) {
      setWritable(value);
      editorRef.current?.setEditable(value, false);
    }
  }
  async function acquire() {
    if (!navigator.locks) {
      setLockStatus(
        "Browser นี้ไม่รองรับการล็อกโน้ต กรุณาใช้ Chrome, Edge, Firefox หรือ Safari รุ่นใหม่",
      );
      return;
    }
    await navigator.locks.request(
      `clever-note:${note.id}`,
      { ifAvailable: true },
      async (lock) => {
        if (!alive.current) return;
        if (!lock) {
          setAccess(false);
          setLockStatus("โน้ตนี้เปิดแก้ไขอยู่ในอีกแท็บ คุณยังอ่านได้");
          return;
        }
        if (!dirty.current) {
          // Take the newest saved copy now that this tab owns the note. If the fetch
          // fails, the copy already loaded is kept; a stale save is rejected by revision.
          const latest = await fetchNote(note.id).catch(() => null);
          if (latest && alive.current) {
            draft.current = latest;
            setTitle(latest.title);
            editorRef.current?.commands.setContent(latest.document, {
              emitUpdate: false,
            });
          }
        }
        if (!alive.current) return;
        setAccess(true);
        ownedNoteLocks.add(note.id);
        setLockStatus("");
        await new Promise<void>((resolve) => {
          release.current = resolve;
        });
        release.current = null;
        ownedNoteLocks.delete(note.id);
      },
    );
  }
  useEffect(() => {
    alive.current = true;
    flushRef.current = () => flushLatest.current();
    channel.current = new BroadcastChannel("clever-note-locks");
    channel.current.onmessage = async (event) => {
      if (
        event.data?.type === "request" &&
        event.data.id === note.id &&
        release.current
      ) {
        setAccess(false);
        try {
          await flushLatest.current();
          release.current?.();
          setLockStatus("ส่งสิทธิ์แก้ไขให้อีกแท็บแล้ว");
          channel.current?.postMessage({ type: "released", id: note.id });
        } catch {
          setAccess(true);
        }
      } else if (
        event.data?.type === "released" &&
        event.data.id === note.id &&
        !writableRef.current
      )
        void acquire().catch((e) => onError(String(e)));
    };
    void acquire().catch((e) => onError(String(e)));
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        void flushLatest.current().catch(() => {});
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden")
        void flushLatest.current().catch(() => {});
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      request.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      void flushLatest
        .current()
        .catch(() => {})
        .finally(() => release.current?.());
      channel.current?.close();
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    // Another device or tab saved a newer revision: adopt it unless this editor has
    // unsaved work or a save in flight (its own save also raises the list revision).
    if (
      dirty.current ||
      saving.current ||
      remoteRevision <= draft.current.revision
    )
      return;
    void fetchNote(note.id)
      .then((latest) => {
        if (
          !latest ||
          !alive.current ||
          dirty.current ||
          latest.revision <= draft.current.revision
        )
          return;
        draft.current = latest;
        setTitle(latest.title);
        editorRef.current?.commands.setContent(latest.document, {
          emitUpdate: false,
        });
      })
      .catch(() => {});
  }, [remoteRevision]);
  useEffect(() => {
    if (editor) editor.setEditable(writable, false);
  }, [editor, writable]);

  function selectScope(
    kind: "selection" | "block" | "section",
    position?: number,
  ) {
    if (!editor) return;
    request.current?.abort();
    generationAI.current++;
    setBusy(false);
    setResult("");
    setAiError("");
    try {
      const captured = captureScope(editor, kind, position);
      scopeRef.current = captured;
      setScope(captured);
      setAiOpen(true);
    } catch (e) {
      setAiOpen(true);
      setScope(null);
      scopeRef.current = null;
      setAiError(e instanceof Error ? e.message : "เลือกขอบเขตไม่สำเร็จ");
    }
  }
  async function generate() {
    if (!scope || scope.stale) return;
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generationAI.current;
    setBusy(true);
    setAiError("");
    setResult("");
    try {
      const text = await summarize(
        preferences.connection,
        apiKey,
        scope.text,
        { format, length, language },
        controller.signal,
      );
      if (
        alive.current &&
        ticket === generationAI.current &&
        !controller.signal.aborted
      )
        { setResult(text); setResultModel(preferences.connection.model); }
    } catch (e) {
      if (alive.current && ticket === generationAI.current)
        setAiError(e instanceof Error ? e.message : "สร้างสรุปไม่สำเร็จ");
    } finally {
      if (alive.current && ticket === generationAI.current) setBusy(false);
    }
  }
  function applySummary(replace: boolean) {
    if (!editor || !scopeRef.current || !result || !writableRef.current) return;
    const s = scopeRef.current;
    if (s.stale || signature(editor.state.doc, s.from, s.to) !== s.signature) {
      setAiError("ต้นฉบับมีการแก้ไข กรุณาเลือกส่วนและสร้างสรุปใหม่");
      return;
    }
    if (replace && s.images) return;
    const paragraphs = result
      .split(/\n+/)
      .filter(Boolean)
      .map((text) => ({
        type: "paragraph",
        attrs: { blockId: uid() },
        content: [{ type: "text", text }],
      }));
    const summary: JSONContent = {
      type: "summary",
      attrs: {
        blockId: uid(),
        model: resultModel,
        createdAt: now(),
        sourceIds: s.sourceIds,
        sourceFrom: s.from,
        sourceTo: s.to,
        sourceHash: hashText(s.text),
        excludeSummaries: s.section,
        mode: replace ? "replace" : "insert",
        stale: false,
      },
      content: paragraphs,
    };
    editor.view.dispatch(closeHistory(editor.state.tr));
    scopeRef.current = null;
    setScope(null);
    if (replace && !s.fullBlocks)
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.insertText(result, s.replaceFrom, s.to);
          return true;
        })
        .run();
    else if (replace)
      editor
        .chain()
        .focus()
        .insertContentAt({ from: s.replaceFrom, to: s.to }, summary)
        .run();
    else editor.chain().focus().insertContentAt(s.insertAt, summary).run();
    editor.view.dispatch(closeHistory(editor.state.tr));
    setResult("");
    setAiOpen(false);
  }
  async function moveNote(categoryId: string | null) {
    try {
      change({ categoryId });
      await flush();
    } catch {}
  }
  const headings: { pos: number; level: number; text: string }[] = [];
  editor?.state.doc.forEach((n, pos) => {
    if (n.type.name === "heading")
      headings.push({ pos, level: n.attrs.level, text: n.textContent });
  });
  const tools = [
    {
      name: "ตัวหนา",
      icon: Bold,
      active: editor?.isActive("bold"),
      action: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      name: "ตัวเอียง",
      icon: Italic,
      active: editor?.isActive("italic"),
      action: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      name: "ขีดฆ่า",
      icon: Strikethrough,
      active: editor?.isActive("strike"),
      action: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      name: "Inline code",
      icon: Code,
      active: editor?.isActive("code"),
      action: () => editor?.chain().focus().toggleCode().run(),
    },
  ];
  const listTools = [
    {
      name: "Bullet list",
      icon: List,
      action: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      name: "Numbered list",
      icon: ListOrdered,
      action: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "Checklist",
      icon: ListChecks,
      action: () => editor?.chain().focus().toggleTaskList().run(),
    },
    {
      name: "อ้างอิง",
      icon: Quote,
      action: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "เส้นคั่น",
      icon: Minus,
      action: () => editor?.chain().focus().setHorizontalRule().run(),
    },
  ];
  function dismissAI() {
    request.current?.abort();
    generationAI.current++;
    setBusy(false);
    setAiOpen(false);
    editor?.commands.focus();
  }
  return (
    <div className={`editor-layout ${aiOpen ? "with-ai" : ""}`}>
      <section className="editor-panel">
        <div className="document-topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-back"
              aria-label="กลับไปรายการโน้ต"
              onClick={onBack}
            >
              <ChevronLeft size={18} />
            </button>
            <span className="section-kicker">WORKSPACE</span>
            <span>/</span>
            <span>{categoryPath(categories, draft.current.categoryId)}</span>
          </div>
          <div className="actions compact">
            <button
              className="icon-button"
              aria-label={focus ? "ออกจาก Focus mode" : "Focus mode"}
              title="Focus mode"
              onClick={toggleFocus}
            >
              {focus ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            <button
              className={`icon-button ${toc ? "active" : ""}`}
              aria-label="สารบัญ"
              title="สารบัญ"
              onClick={() => setToc(!toc)}
            >
              <ListTree size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="ส่งออก Markdown"
              title="ส่งออก Markdown พร้อมภาพ"
              onClick={async () => {
                try {
                  download(
                    await exportMarkdown({
                      ...draft.current,
                      document: editor?.getJSON() || draft.current.document,
                    }),
                    "clever-note-markdown.zip",
                  );
                } catch (e) {
                  onError(String(e));
                }
              }}
            >
              <Download size={18} />
            </button>
            <button
              className="icon-button danger-text"
              disabled={!writable}
              aria-label="ลบโน้ต"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
        {!writable && (
          <div className="lock-banner" role="status">
            {lockStatus}
            <button
              onClick={() => {
                channel.current?.postMessage({ type: "request", id: note.id });
                void acquire().catch((e) => onError(String(e)));
              }}
            >
              ขอสิทธิ์แก้ไข
            </button>
          </div>
        )}
        <div
          className="format-toolbar"
          role="toolbar"
          aria-label="จัดรูปแบบโน้ต"
        >
          <select
            aria-label="ระดับหัวข้อ"
            disabled={!writable}
            value={
              editor?.isActive("heading", { level: 1 })
                ? "1"
                : editor?.isActive("heading", { level: 2 })
                  ? "2"
                  : editor?.isActive("heading", { level: 3 })
                    ? "3"
                    : "0"
            }
            onChange={(e) => {
              const level = Number(e.target.value);
              if (level)
                editor
                  ?.chain()
                  .focus()
                  .setHeading({ level: level as 1 | 2 | 3 })
                  .run();
              else editor?.chain().focus().setParagraph().run();
            }}
          >
            <option value="0">ข้อความ</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
          <span className="toolbar-separator" />
          {tools.map((t) => (
            <button
              key={t.name}
              aria-label={t.name}
              title={t.name}
              disabled={!writable}
              className={`icon-button ${t.active ? "active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.action}
            >
              <t.icon size={17} />
            </button>
          ))}
          <select
            aria-label="สีไฮไลต์"
            disabled={!writable}
            value={editor?.getAttributes("highlight").color || ""}
            onChange={(e) => {
              if (e.target.value)
                editor
                  ?.chain()
                  .focus()
                  .setHighlight({ color: e.target.value })
                  .run();
              else editor?.chain().focus().unsetHighlight().run();
            }}
          >
            <option value="">ไฮไลต์</option>
            <option value="#b7ff3c">เขียว</option>
            <option value="#c4a4ff">ม่วง</option>
            <option value="#ffce6b">เหลือง</option>
          </select>
          <button
            className="icon-button"
            aria-label="เพิ่มหรือแก้ไขลิงก์"
            title="เพิ่มลิงก์ · Ctrl+คลิกเพื่อเปิด"
            disabled={!writable}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setLinkValue(editor?.getAttributes("link").href || "");
              setLinkOpen(true);
            }}
          >
            <Link size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="เพิ่มรูปภาพ"
            disabled={!writable}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={18} />
          </button>
          <span className="toolbar-separator" />
          {listTools.map((t) => (
            <button
              key={t.name}
              className="icon-button"
              aria-label={t.name}
              title={t.name}
              disabled={!writable}
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.action}
            >
              <t.icon size={17} />
            </button>
          ))}
          <span className="toolbar-separator" />
          <button
            className="icon-button"
            aria-label="Undo"
            disabled={!writable || !editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Redo"
            disabled={!writable || !editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={17} />
          </button>
          <button
            className="ai-trigger"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectScope("selection")}
          >
            <Sparkles size={15} />
            สรุปส่วนนี้
          </button>
        </div>
        <input
          ref={fileRef}
          aria-label="อัปโหลดรูปภาพ"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void addImages(files);
          }}
        />
        <div className="document-scroll">
          {toc && (
            <nav className="toc" aria-label="สารบัญของโน้ต">
              <div className="section-kicker">ON THIS PAGE</div>
              {headings.length ? (
                headings.map((h) => (
                  <div key={h.pos} style={{ paddingLeft: (h.level - 1) * 12 }}>
                    <button
                      onClick={() =>
                        editor
                          ?.chain()
                          .focus()
                          .setTextSelection(h.pos + 1)
                          .scrollIntoView()
                          .run()
                      }
                    >
                      {h.text || "หัวข้อไม่มีชื่อ"}
                    </button>
                    <button
                      className="icon-button"
                      title="สรุปหัวข้อนี้"
                      aria-label={`สรุปหัวข้อ ${h.text}`}
                      onClick={() => selectScope("section", h.pos)}
                    >
                      <Sparkles size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted small">
                  เพิ่มหัวข้อ H1–H3 เพื่อสร้างสารบัญ
                </p>
              )}
            </nav>
          )}
          <article
            className="document"
            style={
              {
                "--editor-font-size": `${preferences.fontSize}px`,
              } as React.CSSProperties
            }
          >
            <div className="note-eyebrow">
              <span className="tiny-square" /> A SPACE FOR YOUR THOUGHTS{" "}
              <span className="note-number">
                NOTE / {note.id.slice(0, 4).toUpperCase()}
              </span>
            </div>
            <input
              className="note-title"
              aria-label="ชื่อโน้ต"
              value={title}
              maxLength={300}
              placeholder="Untitled note"
              readOnly={!writable}
              onChange={(e) => {
                setTitle(e.target.value);
                change({ title: e.target.value });
              }}
            />
            <div className="note-meta">
              <span>
                แก้ไข{" "}
                {new Date(draft.current.updatedAt).toLocaleDateString("th-TH", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span>•</span>
              <select
                aria-label="ย้ายโน้ตไปหมวดหมู่"
                disabled={!writable}
                value={draft.current.categoryId || ""}
                onChange={(e) => void moveNote(e.target.value || null)}
              >
                <option value="">Inbox</option>
                {categories
                  .filter((c) => !c.deletedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryPath(categories, c.id)}
                    </option>
                  ))}
              </select>
            </div>
            <EditorContent editor={editor} />
            {slash && writable && (
              <div className="slash-menu">
                <div className="section-kicker">เพิ่มเนื้อหา</div>
                {[
                  {
                    label: "หัวข้อ",
                    run: () =>
                      editor?.chain().focus().setHeading({ level: 2 }).run(),
                  },
                  { label: "รูปภาพ", run: () => fileRef.current?.click() },
                  {
                    label: "Checklist",
                    run: () => editor?.chain().focus().toggleTaskList().run(),
                  },
                  {
                    label: "สรุปหัวข้อปัจจุบัน",
                    run: () => selectScope("section"),
                  },
                ].map((c) => (
                  <button
                    key={c.label}
                    onClick={() => {
                      const sel = editor?.state.selection;
                      if (sel)
                        editor?.commands.deleteRange({
                          from: sel.$from.start(),
                          to: sel.$from.end(),
                        });
                      setSlash(false);
                      c.run();
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <div className="document-end">
              <span /> YOUR NEXT IDEA STARTS HERE <span />
            </div>
          </article>
        </div>
        <footer className="editor-footer">
          <span>
            <span className="status-dot" />
            บันทึกในเครื่องของคุณ
          </span>
          <span>
            {editor?.getText().length.toLocaleString() || 0} ตัวอักษร{" "}
            <span className="footer-divider">/</span>{" "}
            <button onClick={() => selectScope("block")}>สรุปบล็อก</button>{" "}
            <button onClick={() => selectScope("section")}>สรุปหัวข้อ</button>
          </span>
        </footer>
      </section>
      {aiOpen && (
        <aside className="ai-panel" aria-label="ผู้ช่วยสรุป AI">
          <div className="ai-panel-head">
            <div>
              <div className="section-kicker">FOCUSED INTELLIGENCE</div>
              <h2>
                <Sparkles size={21} />
                สรุปให้ชัดขึ้น
              </h2>
            </div>
            <button
              className="icon-button"
              aria-label="ปิดแถบ AI"
              onClick={dismissAI}
            >
              <X size={19} />
            </button>
          </div>
          <div className="ai-panel-body">
            <p className="muted small">
              ส่งเฉพาะข้อความด้านล่าง ส่วนอื่นของโน้ตอยู่กับคุณ
            </p>
            <div className="scope-heading">
              <span>ข้อความที่จะส่ง</span>
              <span>{scope?.text.length.toLocaleString() || 0} ตัวอักษร</span>
            </div>
            <div className="scope-preview">
              {scope?.text || "เลือกข้อความในโน้ต แล้วกด “ใช้ส่วนที่เลือก”"}
            </div>
            <button
              className="subtle full-width"
              disabled={busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectScope("selection")}
            >
              ใช้ส่วนที่เลือก
            </button>
            <div className="ai-options">
              <label>
                รูปแบบ
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="bullet points">Bullet points</option>
                  <option value="short paragraph">ย่อหน้าสั้น</option>
                  <option value="key takeaways">ประเด็นสำคัญ</option>
                </select>
              </label>
              <label>
                ความยาว
                <select
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                >
                  <option value="short">สั้น</option>
                  <option value="medium">ปานกลาง</option>
                  <option value="detailed">ละเอียด</option>
                </select>
              </label>
            </div>
            <label>
              ภาษา
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="Thai">ไทย</option>
                <option value="English">English</option>
                <option value="same language as source">ตามต้นฉบับ</option>
              </select>
            </label>
            {!preferences.connection.baseUrl && (
              <div className="notice column">
                เชื่อมต่อ API เพื่อเริ่มใช้ AI
                <button onClick={onSettings}>ตั้งค่า AI connection</button>
              </div>
            )}
            {scope?.stale && (
              <p className="warning" role="status">
                ต้นฉบับมีการแก้ไข กรุณาเลือกขอบเขตและสร้างสรุปใหม่
              </p>
            )}
            {aiError && (
              <p className="error" role="alert">
                {aiError}
              </p>
            )}
            {busy ? (
              <button
                className="full-width"
                onClick={() => {
                  request.current?.abort();
                  generationAI.current++;
                  setBusy(false);
                  setAiError("ยกเลิกแล้ว Provider อาจประมวลผลไปแล้ว");
                }}
              >
                กำลังสรุป… ยกเลิก
              </button>
            ) : (
              <button
                className="primary full-width"
                disabled={
                  !scope ||
                  scope.stale ||
                  scope.text.length > 24000 ||
                  !preferences.connection.baseUrl
                }
                onClick={() => void generate()}
              >
                <Sparkles size={17} />
                {result ? "ลองสรุปใหม่" : "สร้างสรุป"}
              </button>
            )}
            {scope && scope.text.length > 24000 && (
              <p className="error">เลือกข้อความไม่เกิน 24,000 ตัวอักษร</p>
            )}
            {result && (
              <div className="ai-result">
                <div className="section-kicker">SUMMARY PREVIEW</div>
                <div className="result-text">{result}</div>
                <small className="muted">
                {resultModel} · ตรวจทานก่อนนำไปใช้
                </small>
                <button
                  className="primary full-width"
                  disabled={!scope || scope.stale || !writable}
                  onClick={() => applySummary(false)}
                >
                  <ArrowDownToLine size={17} />
                  แทรกใต้ส่วนนี้
                </button>
                <button
                  className="full-width"
                  disabled={!scope || scope.stale || scope.images || !writable}
                  onClick={() => applySummary(true)}
                >
                  <Replace size={17} />
                  แทนที่ส่วนที่เลือก
                </button>
                {scope?.images && (
                  <p className="muted small">
                    มีภาพหรือบล็อกที่ไม่ใช่ข้อความในขอบเขต
                    จึงแทรกสรุปได้เท่านั้น
                  </p>
                )}
                <button
                  className="subtle full-width"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(result)
                      .catch(() =>
                        setAiError(
                          "คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง",
                        ),
                      )
                  }
                >
                  <Copy size={15} />
                  คัดลอกสรุป
                </button>
              </div>
            )}
          </div>
          <div className="ai-panel-foot">
            <span className="status-dot" />
            เฉพาะส่วนที่เลือก · คุณเป็นคนตัดสินใจ
          </div>
        </aside>
      )}
      {linkOpen && (
        <Modal title="เพิ่มหรือแก้ไขลิงก์" onClose={() => setLinkOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!safeUrl(linkValue)) {
                onError("ใช้ลิงก์ http, https หรือ mailto ที่ถูกต้อง");
                return;
              }
              editor
                ?.chain()
                .focus()
                .extendMarkRange("link")
                .setLink({
                  href: linkValue,
                  target: "_blank",
                  rel: "noopener noreferrer",
                })
                .run();
              setLinkOpen(false);
            }}
          >
            <div className="settings-body">
              <label>
                URL
                <input
                  autoFocus
                  type="url"
                  value={linkValue}
                  onChange={(e) => setLinkValue(e.target.value)}
                  placeholder="https://…"
                  required
                />
              </label>
              <p className="muted small">
                Ctrl หรือ ⌘ + คลิกลิงก์ในโน้ตเพื่อเปิด
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={() => {
                  editor
                    ?.chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                  setLinkOpen(false);
                }}
              >
                ลบลิงก์
              </button>
              <button className="primary" type="submit">
                บันทึกลิงก์
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title="ย้ายโน้ตเข้าถังขยะ?"
          onClose={() => setConfirmDelete(false)}
        >
          <div className="settings-body">
            <p>คุณกู้คืน “{title || "Untitled"}” ได้จากถังขยะ</p>
          </div>
          <div className="modal-footer">
            <button onClick={() => setConfirmDelete(false)}>ยกเลิก</button>
            <button
              className="danger"
              onClick={async () => {
                try {
                  change({ deletedAt: now() });
                  await flush();
                  setConfirmDelete(false);
                  onBack();
                } catch {}
              }}
            >
              ย้ายเข้าถังขยะ
            </button>
          </div>
        </Modal>
      )}
      <span hidden>{version}</span>
    </div>
  );
}
