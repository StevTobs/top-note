import { useState } from "react";
import { desktop, signInWithGoogle } from "../supabase";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

export function LoginScreen({ notice }: { notice?: string }) {
  const [busy, setBusy] = useState(false),
    [waiting, setWaiting] = useState(false),
    [error, setError] = useState(notice || "");
  async function login() {
    setBusy(true);
    setError("");
    const { error } = await signInWithGoogle();
    // On the web the page navigates to Google, so only failures return here. The desktop app
    // signs in in the system browser and returns here immediately, so let the button be reused.
    if (error) {
      setError("เริ่มการเข้าสู่ระบบด้วย Google ไม่สำเร็จ: " + error.message);
      setBusy(false);
    } else if (desktop) {
      setBusy(false);
      setWaiting(true);
    }
  }
  return (
    <div className="boot login">
      <div className="brand-mark">
        T<span>▰</span>
      </div>
      <div className="section-kicker">THINK. CONNECT. CREATE.</div>
      <h1>Top Note</h1>
      <p>เข้าสู่ระบบเพื่อเปิดโน้ตของคุณจากทุกอุปกรณ์</p>
      <button className="primary google-button" disabled={busy} onClick={login}>
        <GoogleMark />
        {busy ? "กำลังไปยัง Google…" : "เข้าสู่ระบบด้วย Google"}
      </button>
      {waiting && (
        <p role="status" className="muted">
          เปิดเบราว์เซอร์ให้แล้ว กรุณาเข้าสู่ระบบด้วย Google ที่นั่น
          เสร็จแล้วแอปนี้จะเปิดโน้ตให้อัตโนมัติ
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <small className="muted">
        โน้ตของคุณเก็บในบัญชี Supabase ของโปรเจกต์นี้
        และเข้าถึงได้เฉพาะบัญชีที่ล็อกอินเท่านั้น
      </small>
    </div>
  );
}

export function SetupScreen() {
  return (
    <div className="boot login">
      <h1>ยังไม่ได้ตั้งค่า Supabase</h1>
      <p>
        สร้างไฟล์ <code>.env</code> แล้วใส่ <code>VITE_SUPABASE_URL</code> และ{" "}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (ดู <code>.env.example</code>
        ) จากนั้นรีสตาร์ท dev server หรือ build ใหม่
      </p>
    </div>
  );
}
