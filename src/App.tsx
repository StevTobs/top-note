import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Search,
  Plus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Settings as SettingsIcon,
  Trash2,
  Inbox,
  FileText,
  MoreHorizontal,
  ArrowUpRight,
  Command,
  Menu,
  X,
  RotateCcw,
  Download,
  CheckCheck,
  WifiOff,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  FolderKanban,
  Star,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  createNote,
  patchNote,
  reorderNote,
  toggleNoteFavorite,
  fetchNote,
  restoreCategory,
  reorderCategory,
  toggleCategoryFavorite,
  permanentlyDeleteNote,
  ensureAccount,
  seedWelcome,
  loadAll,
  refreshAll,
  savePreferences,
} from "./db";
import { dropOrder } from "./ordering";
import { resetStore, useStore } from "./store";
import { clearAssetCache } from "./assets";
import {
  type LegacyCounts,
  detectLegacy,
  legacyChoice,
  rememberLegacyChoice,
} from "./legacy";
import { supabase, supabaseConfigured, signOut } from "./supabase";
import { type Category, type Note, descendants, categoryPath } from "./model";
import { NoteEditor } from "./components/NoteEditor";
import { Settings } from "./components/Settings";
import { CategoryDialog } from "./components/CategoryDialog";
import { LegacyPanel } from "./components/LegacyPanel";
import { LoginScreen, SetupScreen } from "./components/LoginScreen";
import { Modal } from "./components/Modal";
import { Planner } from "./planner/Planner";
import { useUpdateAvailable, applyUpdate } from "./pwaUpdate";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const API_KEY_STORAGE_KEY = "clever-note-api-key";
function Workspace({
  session,
  onOpenPlanner,
}: {
  session: Session;
  onOpenPlanner: () => void;
}) {
  const user = session.user,
    displayName: string = user.user_metadata?.full_name || "My workspace";
  const { notes, categories, preferences, mySharedNotes, loaded } = useStore();
  const [fatal, setFatal] = useState(""),
    [legacy, setLegacy] = useState<{
      counts: LegacyCounts;
      copyPreferences: boolean;
    } | null>(null),
    [openNote, setOpenNote] = useState<Note | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [includeChildren, setIncludeChildren] = useState(true),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [settings, setSettings] = useState(false),
    [categoryDialog, setCategoryDialog] = useState<{
      category?: Category;
      parentId: string | null;
    } | null>(null),
    [apiKey, setApiKey] = useState(
      () => localStorage.getItem(API_KEY_STORAGE_KEY) || "",
    ),
    [rememberKey, setRememberKey] = useState(
      () => localStorage.getItem(API_KEY_STORAGE_KEY) !== null,
    ),
    [focus, setFocus] = useState(false),
    [sidebarHidden, setSidebarHidden] = useState(false),
    [mobilePage, setMobilePage] = useState<"list" | "editor" | "categories">(
      "list",
    ),
    [saveStatus, setSaveStatus] = useState("บันทึกแล้ว"),
    [error, setError] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [confirmPermanent, setConfirmPermanent] = useState<string | null>(null),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [dragOverId, setDragOverId] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const flushRef = useRef<() => Promise<void>>(async () => {}),
    searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { created } = await ensureAccount();
      const counts = await detectLegacy();
      // A brand-new account gets the welcome note, unless this browser has notes to move over.
      if (created && !counts) await seedWelcome();
      await loadAll();
      if (!cancelled && counts && !legacyChoice(user.id))
        setLegacy({ counts, copyPreferences: created });
    })().catch((e) => {
      if (!cancelled) setFatal(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  useEffect(() => {
    if (!loaded) return;
    // Pick up edits made on another device when this tab is shown or reconnects.
    let last = Date.now();
    const sync = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < 10_000)
        return;
      last = Date.now();
      void refreshAll().catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
    };
  }, [loaded]);
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    const pwa = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", pwa);
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("beforeinstallprompt", pwa);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.motion = preferences.reducedMotion
      ? "reduced"
      : "normal";
  }, [preferences.theme, preferences.reducedMotion]);
  useEffect(() => {
    if (rememberKey && apiKey)
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    else localStorage.removeItem(API_KEY_STORAGE_KEY);
  }, [apiKey, rememberKey]);
  const selectedNote = notes.find((n) => n.id === selected && !n.deletedAt),
    selectedId = selectedNote?.id ?? null;
  useEffect(() => {
    if (loaded && !selected && notes.some((n) => !n.deletedAt))
      setSelected(notes.find((n) => !n.deletedAt)!.id);
  }, [loaded, notes, selected]);
  useEffect(() => {
    // The list only carries summaries; the document is fetched when a note is opened.
    setOpenNote(null);
    if (!selectedId) return;
    let cancelled = false;
    fetchNote(selectedId)
      .then((n) => {
        if (!cancelled) setOpenNote(n);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "โหลดโน้ตไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);
  const activeCategories = categories
      .filter((c) => !c.deletedAt)
      .sort(
        (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order,
      ),
    trash = filter === "trash",
    favoritesOnly = filter === "favorites",
    customSort = preferences.noteSort === "custom";
  const ids =
    filter === "all" || filter === "inbox" || trash || favoritesOnly
      ? new Set<string>()
      : includeChildren
        ? descendants(activeCategories, filter)
        : new Set([filter]);
  const visible = notes
    .filter((n) =>
      trash
        ? !!n.deletedAt
        : !n.deletedAt &&
          (favoritesOnly
            ? n.favorite
            : filter === "all" ||
              (filter === "inbox"
                ? !n.categoryId
                : !!n.categoryId && ids.has(n.categoryId))),
    )
    .filter((n) =>
      `${n.title}\n${n.plainText}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      customSort && !trash
        ? Number(b.favorite) - Number(a.favorite) || a.sortOrder - b.sortOrder
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const filterName =
    filter === "all"
      ? "โน้ตทั้งหมด"
      : filter === "inbox"
        ? "Inbox"
        : trash
          ? "ถังขยะ"
          : favoritesOnly
            ? "รายการโปรด"
            : activeCategories.find((c) => c.id === filter)?.name ||
              "โน้ตทั้งหมด";
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  async function chooseNote(id: string) {
    await flushRef.current();
    setSelected(id);
    setMobilePage("editor");
    setSaveStatus("บันทึกแล้ว");
  }
  async function newNote() {
    await flushRef.current();
    const n = await createNote(
      activeCategories.some((c) => c.id === filter) ? filter : null,
    );
    if (trash) setFilter("all");
    setSearch("");
    setSelected(n.id);
    setMobilePage("editor");
  }
  async function chooseFilter(id: string) {
    await flushRef.current();
    setFilter(id);
    setMobilePage("list");
    if (id === "trash") setSelected(null);
  }
  async function dropCategory(
    parentId: string | null,
    targetId: string | null,
    e: React.DragEvent,
  ) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    setDragOverId(null);
    const dragged = activeCategories.find((c) => c.id === draggedId);
    // Reordering only, within the same parent — dragging onto a different branch is a no-op.
    if (!dragged || draggedId === targetId || dragged.parentId !== parentId)
      return;
    const siblings = activeCategories.filter(
      (c) => c.parentId === parentId && c.id !== draggedId,
    );
    const order = await dropOrder(siblings, targetId, reorderCategory);
    await reorderCategory(draggedId, order);
  }
  async function dropNote(targetId: string | null, e: React.DragEvent) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    setDragOverId(null);
    if (!draggedId || draggedId === targetId || !customSort) return;
    const dragged = notes.find((n) => n.id === draggedId);
    if (!dragged) return;
    const siblings = visible
      .filter((n) => n.id !== draggedId)
      .map((n) => ({ id: n.id, order: n.sortOrder }));
    const order = await dropOrder(siblings, targetId, (id, o) => {
      const n = notes.find((x) => x.id === id);
      return n ? reorderNote(id, o, n.revision) : Promise.resolve();
    });
    await reorderNote(draggedId, order, dragged.revision);
  }
  function categoryTree(parent: string | null, depth = 0): React.ReactNode {
    return activeCategories
      .filter((c) => c.parentId === parent)
      .map((c) => {
        const children = activeCategories.some((x) => x.parentId === c.id),
          isCollapsed = collapsed.has(c.id);
        return (
          <div key={c.id}>
            <div
              className={`category-row ${filter === c.id ? "selected" : ""} ${dragOverId === c.id ? "drag-over" : ""}`}
              style={{ paddingLeft: 12 + depth * 16 }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(c.id);
              }}
              onDragLeave={() =>
                setDragOverId((id) => (id === c.id ? null : id))
              }
              onDrop={(e) => void dropCategory(c.parentId, c.id, e)}
            >
              <button
                className="tree-toggle"
                disabled={!children}
                aria-label={`${isCollapsed ? "ขยาย" : "ย่อ"} ${c.name}`}
                aria-expanded={children ? !isCollapsed : undefined}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                    return next;
                  })
                }
              >
                {children ? (
                  isCollapsed ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )
                ) : (
                  <span className="tree-dot" />
                )}
              </button>
              <button
                className="category-name"
                aria-current={filter === c.id ? "page" : undefined}
                onClick={() => void run(() => chooseFilter(c.id))}
              >
                {filter === c.id ? (
                  <FolderOpen size={16} />
                ) : (
                  <Folder size={16} />
                )}
                <span>{c.name}</span>
              </button>
              <button
                className={`favorite-star icon-button ${c.favorite ? "active" : ""}`}
                aria-label={
                  c.favorite ? `เลิกปักหมุด ${c.name}` : `ปักหมุด ${c.name}`
                }
                onClick={() =>
                  void run(() => toggleCategoryFavorite(c.id, !c.favorite))
                }
              >
                <Star size={14} fill={c.favorite ? "currentColor" : "none"} />
              </button>
              <button
                className="category-more icon-button"
                aria-label={`จัดการ ${c.name}`}
                onClick={() =>
                  setCategoryDialog({ category: c, parentId: c.parentId })
                }
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
            {!isCollapsed && categoryTree(c.id, depth + 1)}
          </div>
        );
      });
  }
  if (fatal)
    return (
      <div className="boot">
        <h1>โหลดข้อมูลจาก Supabase ไม่ได้</h1>
        <p>{fatal}</p>
        <div className="actions">
          <button onClick={() => location.reload()}>ลองใหม่</button>
          <button onClick={() => void signOut()}>ออกจากระบบ</button>
        </div>
      </div>
    );
  if (!loaded)
    return (
      <div className="boot">
        <div className="brand-mark">
          C<span>▰</span>
        </div>
        <p>กำลังเตรียมพื้นที่สำหรับความคิด…</p>
      </div>
    );
  return (
    <div
      className={`app ${focus ? "focus-mode" : ""} ${sidebarHidden ? "sidebar-hidden" : ""} mobile-${mobilePage}`}
    >
      <header className="app-header">
        <button
          className="brand"
          onClick={() => void run(() => chooseFilter("all"))}
        >
          <span className="brand-mark">
            T<span>▰</span>
          </span>
          <span>
            TOP<span className="brand-light">NOTE</span>
            <small>THINK. CONNECT. CREATE.</small>
          </span>
        </button>
        <div className="global-search">
          <Search size={17} />
          <input
            ref={searchRef}
            aria-label="ค้นหาโน้ต"
            placeholder="ค้นหาความคิดของคุณ…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setMobilePage("list");
            }}
          />
          <kbd>
            <Command size={11} /> K
          </kbd>
          {search && (
            <button
              className="icon-button"
              aria-label="ล้างการค้นหา"
              onClick={() => setSearch("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="header-status">
          <span
            className={`save-indicator ${saveStatus === "บันทึกไม่สำเร็จ" ? "error" : ""}`}
            role="status"
          >
            {saveStatus === "บันทึกแล้ว" ? (
              <CheckCheck size={15} />
            ) : (
              <span className="status-dot" />
            )}
            {saveStatus}
          </span>
          <span className="network-indicator">
            {online ? <span className="status-dot" /> : <WifiOff size={14} />}{" "}
            {online ? "CLOUD SYNC" : "ออฟไลน์ · บันทึกไม่ได้"}
          </span>
          <button
            className="icon-button"
            aria-label="ตั้งค่า"
            onClick={() => setSettings(true)}
          >
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="workspace-name">
            <span className="workspace-avatar">
              {(displayName || "?").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{displayName}</strong>
              <small>{user.email}</small>
            </div>
            <button
              className="icon-button sidebar-collapse"
              aria-label="ซ่อนหมวดหมู่"
              onClick={() => setSidebarHidden(true)}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          <button
            className="new-note primary"
            aria-label="สร้างโน้ตใหม่"
            disabled={busy}
            onClick={() => void run(newNote)}
          >
            <Plus size={18} />
            สร้างโน้ตใหม่<small>↗</small>
          </button>
          <button className="planner-cta" onClick={onOpenPlanner}>
            <FolderKanban size={18} />
            วางแผนโปรเจกต์<small>↗</small>
          </button>
          <nav aria-label="หมวดหมู่">
            <button
              className={`nav-item ${filter === "all" ? "selected" : ""}`}
              onClick={() => void run(() => chooseFilter("all"))}
            >
              <FileText size={17} />
              โน้ตทั้งหมด<span>{notes.filter((n) => !n.deletedAt).length}</span>
            </button>
            <button
              className={`nav-item ${filter === "inbox" ? "selected" : ""}`}
              onClick={() => void run(() => chooseFilter("inbox"))}
            >
              <Inbox size={17} />
              Inbox
              <span>
                {notes.filter((n) => !n.deletedAt && !n.categoryId).length}
              </span>
            </button>
            <button
              className={`nav-item ${favoritesOnly ? "selected" : ""}`}
              onClick={() => void run(() => chooseFilter("favorites"))}
            >
              <Star size={16} />
              รายการโปรด
              <span>
                {notes.filter((n) => !n.deletedAt && n.favorite).length}
              </span>
            </button>
            <div className="nav-heading">
              <span>COLLECTIONS</span>
              <button
                className="icon-button"
                aria-label="สร้างหมวดหมู่"
                title="สร้างหมวดหมู่"
                onClick={() => setCategoryDialog({ parentId: null })}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="category-tree">
              {categoryTree(null)}
              {!activeCategories.length && (
                <p className="muted small sidebar-hint">
                  จัดความคิดด้วยหมวดหมู่แรกของคุณ
                </p>
              )}
            </div>
            {activeCategories.some((c) => c.id === filter) && (
              <button
                className="add-child"
                onClick={() => setCategoryDialog({ parentId: filter })}
              >
                <Plus size={14} />
                เพิ่มหมวดย่อย
              </button>
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-card">
              <div className="local-orbit" />
              <div className="section-kicker">YOUR IDEAS. YOUR SPACE.</div>
              <p>
                ทุกความคิด
                <br />
                เริ่มต้นที่นี่
              </p>
              <small>บันทึกบนคลาวด์ · ใช้ได้ทุกอุปกรณ์ที่ล็อกอิน</small>
              <ArrowUpRight size={18} />
            </div>
            <button
              className={`nav-item ${trash ? "selected" : ""}`}
              onClick={() => void run(() => chooseFilter("trash"))}
            >
              <Trash2 size={16} />
              ถังขยะ<span>{notes.filter((n) => n.deletedAt).length}</span>
            </button>
            {install && (
              <button
                className="nav-item"
                onClick={() =>
                  void run(async () => {
                    await install.prompt();
                    await install.userChoice;
                    setInstall(null);
                  })
                }
              >
                <Download size={16} />
                ติดตั้งแอป
              </button>
            )}
            <button className="nav-item" onClick={() => setSettings(true)}>
              <SettingsIcon size={16} />
              ตั้งค่าและสำรองข้อมูล
            </button>
            <button
              className="nav-item"
              onClick={() =>
                void run(async () => {
                  await flushRef.current();
                  const { error } = await signOut();
                  if (error) throw error;
                })
              }
            >
              <LogOut size={16} />
              ออกจากระบบ
            </button>
            <div className="sidebar-signature">
              <span className="tiny-square" />
              TOP SYSTEM / 01<span>v1.1</span>
            </div>
          </div>
        </aside>
        <section className="notes-panel">
          <div className="notes-heading">
            <div>
              <div className="section-kicker">YOUR THOUGHTS, COLLECTED</div>
              <h1>
                {filterName}
                <span>{visible.length}</span>
              </h1>
            </div>
            <button
              className="icon-button"
              aria-label="เพิ่มโน้ต"
              disabled={busy}
              onClick={() => void run(newNote)}
            >
              <Plus size={20} />
            </button>
          </div>
          <div className="list-filter">
            <button
              className="mobile-menu"
              onClick={() => setMobilePage("categories")}
            >
              <Menu size={15} />
              หมวดหมู่
            </button>
            {sidebarHidden && (
              <button
                className="icon-button"
                aria-label="แสดงหมวดหมู่"
                onClick={() => setSidebarHidden(false)}
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
            <span>
              {search
                ? `ผลการค้นหา “${search}”`
                : customSort
                  ? "ลำดับที่จัดเอง"
                  : "แก้ไขล่าสุด"}
            </span>
            {!["all", "inbox", "trash"].includes(filter) && !favoritesOnly && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={includeChildren}
                  onChange={(e) => setIncludeChildren(e.target.checked)}
                />
                รวมหมวดย่อย
              </label>
            )}
            {!trash && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={customSort}
                  onChange={(e) =>
                    void run(() =>
                      savePreferences({
                        ...preferences,
                        noteSort: e.target.checked ? "custom" : "recent",
                      }),
                    )
                  }
                />
                เรียงลำดับเอง
              </label>
            )}
          </div>
          <div className="note-list">
            {visible.map((n) => (
              <div
                key={n.id}
                className={`note-card ${selected === n.id && !trash ? "selected" : ""} ${dragOverId === n.id ? "drag-over" : ""}`}
                draggable={customSort && !trash}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", n.id)}
                onDragOver={(e) => {
                  if (!customSort) return;
                  e.preventDefault();
                  setDragOverId(n.id);
                }}
                onDragLeave={() =>
                  setDragOverId((id) => (id === n.id ? null : id))
                }
                onDrop={(e) => void dropNote(n.id, e)}
              >
                {!trash && (
                  <button
                    className={`favorite-star icon-button ${n.favorite ? "active" : ""}`}
                    aria-label={
                      n.favorite
                        ? `เลิกปักหมุด ${n.title}`
                        : `ปักหมุด ${n.title}`
                    }
                    onClick={() =>
                      void run(async () => {
                        await toggleNoteFavorite(n.id, !n.favorite, n.revision);
                      })
                    }
                  >
                    <Star
                      size={13}
                      fill={n.favorite ? "currentColor" : "none"}
                    />
                  </button>
                )}
                <button
                  className="note-card-main"
                  aria-label={`เปิดโน้ต ${n.title || "Untitled"}`}
                  onClick={() => {
                    if (!trash) void run(() => chooseNote(n.id));
                  }}
                >
                  <div className="note-card-top">
                    <FileText size={15} />
                    <span>
                      {new Date(n.updatedAt).toLocaleDateString("th-TH", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    {selected === n.id && !trash && (
                      <span className="active-note-dot" />
                    )}
                  </div>
                  <h3>{n.title || "Untitled"}</h3>
                  <p>{n.plainText || "พื้นที่ว่างสำหรับไอเดียใหม่…"}</p>
                  <div className="note-card-category">
                    {n.ownerId === user.id ? (
                      <>
                        <Folder size={12} />
                        {categoryPath(categories, n.categoryId)}
                      </>
                    ) : (
                      <>
                        <Users size={12} />
                        แชร์โดย{" "}
                        {mySharedNotes.find((s) => s.noteId === n.id)
                          ?.ownerEmail || "ผู้อื่น"}
                      </>
                    )}
                  </div>
                </button>
                {trash && (
                  <div className="trash-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await patchNote(
                            n.id,
                            {
                              deletedAt: null,
                              categoryId: activeCategories.some(
                                (c) => c.id === n.categoryId,
                              )
                                ? n.categoryId
                                : null,
                            },
                            n.revision,
                          );
                        })
                      }
                    >
                      <RotateCcw size={14} />
                      กู้คืน
                    </button>
                    <button
                      className="danger-text"
                      aria-label={`ลบถาวร ${n.title}`}
                      onClick={() => setConfirmPermanent(n.id)}
                    >
                      <Trash2 size={14} />
                      ลบถาวร
                    </button>
                  </div>
                )}
              </div>
            ))}
            {trash &&
              categories
                .filter(
                  (c) =>
                    c.deletedAt &&
                    (!c.parentId ||
                      !categories.find((p) => p.id === c.parentId)?.deletedAt),
                )
                .map((c) => (
                  <div className="deleted-category" key={c.id}>
                    <Folder size={16} />
                    <span>{c.name}</span>
                    <button
                      disabled={busy}
                      onClick={() => void run(() => restoreCategory(c.id))}
                    >
                      กู้คืนหมวด
                    </button>
                  </div>
                ))}
            {!visible.length && (
              <div className="empty-list">
                <FileText size={30} />
                <h3>
                  {search
                    ? "ยังไม่พบความคิดนี้"
                    : trash
                      ? "ถังขยะว่าง"
                      : "เริ่มโน้ตแรกของคุณ"}
                </h3>
                <p>
                  {search
                    ? "ลองเปลี่ยนคำค้นหรือหมวดหมู่"
                    : "พื้นที่ใหม่สำหรับเรื่องที่คุณอยากจดจำ"}
                </p>
                {!trash && !search && (
                  <button onClick={() => void run(newNote)}>
                    <Plus size={15} />
                    สร้างโน้ต
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="list-footer">
            <span className="tiny-square" />{" "}
            {notes.filter((n) => !n.deletedAt).length} NOTES IN YOUR SPACE
          </div>
        </section>
        {selectedNote && !trash && !openNote ? (
          <main className="empty-workspace">
            <p role="status">กำลังโหลดโน้ต…</p>
          </main>
        ) : selectedNote && openNote && !trash ? (
          <NoteEditor
            key={openNote.id}
            note={openNote}
            remoteRevision={selectedNote.revision}
            categories={categories}
            preferences={preferences}
            apiKey={apiKey}
            isOwner={openNote.ownerId === user.id}
            onSettings={() => setSettings(true)}
            focus={focus}
            toggleFocus={() => setFocus(!focus)}
            onBack={() => setMobilePage("list")}
            flushRef={flushRef}
            onSaveStatus={setSaveStatus}
            onError={setError}
          />
        ) : (
          <main className="empty-workspace">
            <div className="abstract-emblem">
              <div />
              <span>01</span>
            </div>
            <div className="section-kicker">A LITTLE SPACE FOR BIG IDEAS</div>
            <h2>{trash ? "เก็บไว้ ก่อนปล่อยไป" : "ความคิดต่อไปของคุณ"}</h2>
            <p>
              {trash
                ? "กู้คืนโน้ตได้ทุกเมื่อ หรือเลือกลบถาวรเมื่อไม่ต้องการแล้ว"
                : "เลือกโน้ต หรือเริ่มต้นหน้าว่างสำหรับสิ่งใหม่"}
            </p>
            {!trash && (
              <button className="primary" onClick={() => void run(newNote)}>
                <Plus size={18} />
                สร้างโน้ตใหม่
              </button>
            )}
          </main>
        )}
      </div>
      {settings && (
        <Settings
          user={user}
          preferences={preferences}
          apiKey={apiKey}
          setApiKey={setApiKey}
          rememberKey={rememberKey}
          setRememberKey={setRememberKey}
          onClose={() => setSettings(false)}
          flush={() => flushRef.current()}
        />
      )}
      {legacy && (
        <Modal title="ย้ายข้อมูลเดิมขึ้นบัญชี" onClose={() => setLegacy(null)}>
          <div className="settings-body">
            <LegacyPanel
              userId={user.id}
              counts={legacy.counts}
              copyPreferences={legacy.copyPreferences}
              onSkip={() => {
                rememberLegacyChoice(user.id, "skipped");
                setLegacy(null);
              }}
            />
          </div>
        </Modal>
      )}
      {categoryDialog && (
        <CategoryDialog
          {...categoryDialog}
          categories={categories}
          onClose={() => setCategoryDialog(null)}
          beforeChange={() => flushRef.current()}
        />
      )}
      {confirmPermanent && (
        <Modal title="ลบโน้ตถาวร?" onClose={() => setConfirmPermanent(null)}>
          <div className="settings-body">
            <p>การลบนี้ย้อนกลับไม่ได้ รูปที่ไม่มีโน้ตอื่นอ้างอิงจะถูกลบด้วย</p>
          </div>
          <div className="modal-footer">
            <button onClick={() => setConfirmPermanent(null)}>ยกเลิก</button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await permanentlyDeleteNote(confirmPermanent);
                  setConfirmPermanent(null);
                })
              }
            >
              ยืนยันลบถาวร
            </button>
          </div>
        </Modal>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          {saveStatus === "บันทึกไม่สำเร็จ" && (
            <button onClick={() => void run(() => flushRef.current())}>
              ลองบันทึกใหม่
            </button>
          )}
          <button
            className="icon-button"
            aria-label="ปิดข้อความแจ้งเตือน"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// Supabase puts a failed OAuth round trip in the callback URL (query or hash).
function readAuthError(): string {
  const params = new URLSearchParams(
    location.search + "&" + location.hash.replace(/^#/, ""),
  );
  const message = params.get("error_description");
  if (message) history.replaceState(null, "", location.pathname);
  return message ? `เข้าสู่ระบบไม่สำเร็จ: ${message}` : "";
}

function UpdateToast() {
  if (!useUpdateAvailable()) return null;
  return (
    <div className="error-toast update-toast" role="status">
      <span>มีเวอร์ชันใหม่พร้อมใช้งาน</span>
      <button className="primary" onClick={applyUpdate}>
        <RefreshCw size={14} />
        อัปเดตตอนนี้
      </button>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(!supabaseConfigured),
    [notice] = useState(readAuthError),
    [mode, setMode] = useState<"notes" | "planner">("notes");
  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    // getSession() also waits for the OAuth code in the URL to be exchanged.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const userId = session?.user.id;
  useEffect(() => {
    // Nothing from one account may linger in memory after sign-out or a switch.
    if (!userId) {
      resetStore();
      clearAssetCache();
      setMode("notes");
    }
  }, [userId]);
  const content = !supabaseConfigured ? (
    <SetupScreen />
  ) : !ready ? (
    <div className="boot">
      <div className="brand-mark">
        T<span>▰</span>
      </div>
      <p>กำลังตรวจสอบการเข้าสู่ระบบ…</p>
    </div>
  ) : !session ? (
    <LoginScreen notice={notice} />
  ) : mode === "planner" ? (
    <Planner
      key={session.user.id}
      session={session}
      onExit={() => setMode("notes")}
    />
  ) : (
    <Workspace
      key={session.user.id}
      session={session}
      onOpenPlanner={() => setMode("planner")}
    />
  );
  return (
    <>
      {content}
      <UpdateToast />
    </>
  );
}
