import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Download,
  Upload,
  Database,
  Eye,
  EyeOff,
  Check,
  Shield,
  Cpu,
  Palette,
  UserRound,
  LogOut,
} from "lucide-react";
import { Modal } from "./Modal";
import { LegacyPanel } from "./LegacyPanel";
import { savePreferences } from "../db";
import { signOut } from "../supabase";
import { type LegacyCounts, detectLegacy, legacyChoice } from "../legacy";
import { PROVIDERS, type Preferences, type ProviderType } from "../model";
import { listModels, summarize } from "../ai";
import { download, makeBackup, importBackup } from "../backup";

export function Settings({
  user,
  preferences,
  apiKey,
  setApiKey,
  rememberKey,
  setRememberKey,
  onClose,
  flush,
}: {
  user: User;
  preferences: Preferences;
  apiKey: string;
  setApiKey: (key: string) => void;
  rememberKey: boolean;
  setRememberKey: (remember: boolean) => void;
  onClose: () => void;
  flush: () => Promise<void>;
}) {
  const [tab, setTab] = useState("ai"),
    [draft, setDraft] = useState(preferences),
    [showKey, setShowKey] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [legacy, setLegacy] = useState<LegacyCounts | null>(null),
    [models, setModels] = useState<string[]>([]),
    [modelBusy, setModelBusy] = useState(false),
    [modelNote, setModelNote] = useState("");
  useEffect(() => {
    detectLegacy()
      .then(setLegacy)
      .catch(() => {});
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      await savePreferences(draft);
      setMessage("บันทึกการตั้งค่าแล้ว");
    });
  const fetchModels = async () => {
    setModelBusy(true);
    setModelNote("");
    try {
      const list = await listModels(
        draft.connection,
        apiKey,
        new AbortController().signal,
      );
      setModels(list);
      setModelNote(`พบ ${list.length} model`);
      if (!list.includes(draft.connection.model))
        setDraft((d) => ({
          ...d,
          connection: { ...d.connection, model: list[0] },
        }));
    } catch (e) {
      setModels([]);
      setModelNote(e instanceof Error ? e.message : "ดึงรายชื่อ model ไม่สำเร็จ");
    } finally {
      setModelBusy(false);
    }
  };
  return (
    <Modal
      title="ตั้งค่าพื้นที่ทำงาน"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="settings-tabs">
        {[
          { id: "ai", label: "AI connection", icon: Cpu },
          { id: "appearance", label: "รูปลักษณ์", icon: Palette },
          { id: "storage", label: "ข้อมูลและสำรอง", icon: Database },
          { id: "account", label: "บัญชี", icon: UserRound },
        ].map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={17} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-body">
        {tab === "ai" && (
          <>
            <div className="section-kicker">YOUR MODEL. YOUR CHOICE.</div>
            <h3>เชื่อมต่อผู้ช่วยของคุณ</h3>
            <p className="muted">
              ใช้ API รูปแบบ OpenAI-compatible รวมถึง local LLM ที่รองรับ
              โดยส่งเฉพาะข้อความที่เลือกเมื่อคุณกดสร้างสรุป
            </p>
            <label>
              ชื่อการเชื่อมต่อ
              <input
                value={draft.connection.name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    connection: { ...draft.connection, name: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Provider
              <select
                value={draft.connection.providerType || "openai"}
                onChange={(e) => {
                  const providerType = e.target.value as ProviderType;
                  const preset = PROVIDERS.find((p) => p.id === providerType)!;
                  setDraft({
                    ...draft,
                    connection: {
                      ...draft.connection,
                      providerType,
                      baseUrl: preset.baseUrl,
                      model: "",
                    },
                  });
                  setModels([]);
                  setModelNote("");
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Base URL
              <input
                placeholder="https://your-provider.example/v1"
                type="url"
                value={draft.connection.baseUrl}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    connection: {
                      ...draft.connection,
                      baseUrl: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              API key <span className="muted">เก็บเฉพาะครั้งที่เปิดแอปนี้</span>
              <div className="input-group">
                <input
                  autoComplete="off"
                  spellCheck={false}
                  type={showKey ? "text" : "password"}
                  placeholder="เว้นว่างได้สำหรับ local endpoint ที่ไม่ต้องใช้ key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onBlur={() => {
                    if (apiKey && draft.connection.baseUrl) void fetchModels();
                  }}
                />
                <button
                  aria-label={showKey ? "ซ่อน API key" : "แสดง API key"}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              จำ key ไว้บนเครื่องนี้ (เก็บแบบข้อความธรรมดาใน localStorage)
            </label>
            <label>
              Model{" "}
              <span className="muted">
                กรอก API key แล้วออกจากช่องเพื่อดึงรายชื่อ model อัตโนมัติ
              </span>
              <div className="actions">
                {models.length > 0 ? (
                  <select
                    style={{ flex: 1 }}
                    value={draft.connection.model}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        connection: { ...draft.connection, model: e.target.value },
                      })
                    }
                  >
                    {!models.includes(draft.connection.model) &&
                      draft.connection.model && (
                        <option value={draft.connection.model}>
                          {draft.connection.model} (กำหนดเอง)
                        </option>
                      )}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    style={{ flex: 1 }}
                    placeholder="ระบุ model ของ provider หรือดึงอัตโนมัติ"
                    value={draft.connection.model}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        connection: { ...draft.connection, model: e.target.value },
                      })
                    }
                  />
                )}
                <button type="button" disabled={modelBusy} onClick={fetchModels}>
                  {modelBusy ? "กำลังดึง…" : "ดึง model อัตโนมัติ"}
                </button>
              </div>
              {modelNote && <small className="muted">{modelNote}</small>}
            </label>
            <div className="notice">
              <Shield size={18} />
              <span>
                {rememberKey
                  ? "Key ถูกเก็บไว้ในเครื่องนี้ (localStorage) จนกว่าจะกดล้างหรือเลิกติ๊ก \"จำ key\" — ไม่ปลอดภัยเท่าไม่เก็บเลย และไม่ถูกรวมในไฟล์สำรองเสมอ"
                  : "Key ไม่ถูกบันทึกลงเครื่องหรือไฟล์สำรอง เมื่อเปิดใหม่ต้องกรอกอีกครั้ง"}{" "}
                Endpoint ต้องอนุญาต CORS จากเว็บแอปนี้
              </span>
            </div>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await summarize(
                      draft.connection,
                      apiKey,
                      "Connection test. Reply with OK.",
                      {
                        format: "one word",
                        length: "one word",
                        language: "English",
                      },
                      new AbortController().signal,
                    );
                    setMessage("เชื่อมต่อสำเร็จ");
                  })
                }
              >
                ทดสอบการเชื่อมต่อ
              </button>
              <button onClick={() => setApiKey("")}>ล้าง key</button>
            </div>
            <small className="muted">
              การทดสอบส่งข้อความสั้น ๆ ไม่มีข้อมูลโน้ต และอาจมีค่าใช้จ่ายตาม
              provider
            </small>
          </>
        )}
        {tab === "appearance" && (
          <>
            <div className="section-kicker">MAKE ROOM FOR THOUGHT</div>
            <h3>พื้นที่ที่เป็นคุณ</h3>
            <label>
              ธีม
              <select
                value={draft.theme}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    theme: e.target.value as Preferences["theme"],
                  })
                }
              >
                <option value="eva">Eva / ม่วงเข้มและเขียวนีออน</option>
                <option value="quiet">Quiet / ม่วงเทา สงบ</option>
              </select>
            </label>
            <label>
              ขนาดตัวอักษรในโน้ต: {draft.fontSize} px
              <input
                type="range"
                min="14"
                max="24"
                value={draft.fontSize}
                onChange={(e) =>
                  setDraft({ ...draft, fontSize: Number(e.target.value) })
                }
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.reducedMotion}
                onChange={(e) =>
                  setDraft({ ...draft, reducedMotion: e.target.checked })
                }
              />
              ลดการเคลื่อนไหว
            </label>
            <div className="type-preview" style={{ fontSize: draft.fontSize }}>
              ความคิดดี ๆ ต้องการพื้นที่
              <br />
              <strong>ให้ทุกไอเดียเติบโตในแบบของคุณ</strong>
            </div>
          </>
        )}
        {tab === "storage" && (
          <>
            <div className="section-kicker">SYNCED. ON EVERY DEVICE.</div>
            <h3>ข้อมูลอยู่ในบัญชีของคุณบน Supabase</h3>
            <div className="storage-card">
              <Database size={26} />
              <div>
                <strong>บันทึกอัตโนมัติขึ้นคลาวด์</strong>
                <div className="muted">
                  โน้ต หมวดหมู่ และรูปเปิดได้จากทุกอุปกรณ์ที่ล็อกอินด้วย {user.email}
                  ต้องเชื่อมต่ออินเทอร์เน็ตเพื่ออ่านและบันทึก
                </div>
              </div>
            </div>
            <p className="muted">
              ควรสำรองเป็น ZIP เก็บไว้อีกชุดเป็นระยะ ไฟล์รวมโน้ต หมวดหมู่ และภาพ
              แต่ไม่รวม API key
            </p>
            <div className="backup-buttons">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await flush();
                    download(
                      await makeBackup(),
                      `clever-note-${new Date().toISOString().slice(0, 10)}.zip`,
                    );
                    const next = {
                      ...draft,
                      lastBackup: new Date().toISOString(),
                    };
                    setDraft(next);
                    await savePreferences(next);
                    setMessage("สร้างไฟล์สำรองแล้ว");
                  })
                }
              >
                <Download size={18} />
                สำรองข้อมูล ZIP
              </button>
              <label className={`button ${busy ? "disabled" : ""}`}>
                <Upload size={18} />
                นำเข้า ZIP
                <input
                  aria-label="นำเข้าไฟล์สำรอง"
                  type="file"
                  accept=".zip"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file)
                      void run(async () => {
                        await flush();
                        const count = await importBackup(file);
                        setMessage(`นำเข้า ${count} โน้ตในหมวดใหม่แล้ว`);
                      });
                  }}
                />
              </label>
            </div>
            <p className="muted small">
              สำรองล่าสุด:{" "}
              {draft.lastBackup
                ? new Date(draft.lastBackup).toLocaleString("th-TH")
                : "ยังไม่มีการสำรอง"}
            </p>
            <p className="muted small">
              การนำเข้าเพิ่มหมวดใหม่เสมอ ไม่เขียนทับโน้ตเดิม รองรับ ZIP ไม่เกิน
              100 MB
            </p>
          </>
        )}
        {tab === "account" && (
          <>
            <div className="section-kicker">SIGNED IN WITH GOOGLE</div>
            <h3>บัญชี</h3>
            <div className="account-card">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="account-avatar">
                  {(user.email || "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <div>
                <strong>{user.user_metadata?.full_name || user.email}</strong>
                <div className="muted">{user.email}</div>
              </div>
            </div>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await flush();
                    const { error } = await signOut();
                    if (error) throw error;
                  })
                }
              >
                <LogOut size={17} />
                ออกจากระบบ
              </button>
            </div>
            <small className="muted">
              การออกจากระบบไม่ลบโน้ต ข้อมูลยังอยู่ในบัญชีและกลับมาเปิดได้เมื่อล็อกอินใหม่
            </small>
            {legacy && (
              <LegacyPanel
                userId={user.id}
                counts={legacy}
                copyPreferences={false}
              />
            )}
            {legacy && legacyChoice(user.id) === "done" && (
              <small className="muted">
                เคยอัปโหลดข้อมูลเดิมแล้ว การอัปโหลดซ้ำจะข้ามรายการที่มีอยู่ในบัญชี
              </small>
            )}
          </>
        )}
        {busy && (
          <p role="status" className="muted">
            กำลังดำเนินการ…
          </p>
        )}
        {message && (
          <p role="status" className="success">
            <Check size={16} />
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button onClick={onClose} disabled={busy}>
          ปิด
        </button>
        <button className="primary" onClick={save} disabled={busy}>
          บันทึกการตั้งค่า
        </button>
      </div>
    </Modal>
  );
}
