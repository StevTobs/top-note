import { useState } from "react";
import { Check, HardDriveUpload } from "lucide-react";
import {
  type LegacyCounts,
  migrateLegacy,
  rememberLegacyChoice,
} from "../legacy";

/** Offers to upload the notes an older, local-only version of the app left in this browser. */
export function LegacyPanel({
  userId,
  counts,
  copyPreferences,
  onSkip,
}: {
  userId: string;
  counts: LegacyCounts;
  copyPreferences: boolean;
  onSkip?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<[number, number] | null>(null),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  async function upload() {
    setBusy(true);
    setError("");
    try {
      const moved = await migrateLegacy({ copyPreferences }, (done, total) =>
        setProgress([done, total]),
      );
      rememberLegacyChoice(userId, "done");
      setResult(`อัปโหลด ${moved.notes} โน้ต และ ${moved.assets} รูปเรียบร้อย`);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ") +
          " — ลองกดอีกครั้งได้ ระบบจะไม่เขียนทับโน้ตที่อัปโหลดไปแล้ว",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="notice column">
      <strong>
        <HardDriveUpload size={16} /> พบข้อมูลเดิมในเครื่องนี้: {counts.notes}{" "}
        โน้ต · {counts.categories} หมวดหมู่ · {counts.assets} รูป
      </strong>
      <small>
        ข้อมูลเหล่านี้ยังอยู่เฉพาะในเบราว์เซอร์นี้
        กดอัปโหลดเพื่อย้ายขึ้นบัญชีที่ล็อกอินอยู่
        ต้นฉบับในเครื่องจะไม่ถูกแก้ไขหรือลบ
        และโน้ตที่มีอยู่แล้วในบัญชีจะไม่ถูกเขียนทับ
      </small>
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !!result}
          onClick={upload}
        >
          {busy ? "กำลังอัปโหลด…" : "อัปโหลดขึ้นบัญชีนี้"}
        </button>
        {onSkip && !result && (
          <button disabled={busy} onClick={onSkip}>
            ข้าม (ทำภายหลังได้ที่ตั้งค่า → บัญชี)
          </button>
        )}
      </div>
      {progress && busy && (
        <small role="status">
          {progress[0]} / {progress[1]} รายการ
        </small>
      )}
      {result && (
        <p role="status" className="success">
          <Check size={16} />
          {result}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
