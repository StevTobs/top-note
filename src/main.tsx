import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import App from "./App";
import { announceUpdate } from "./pwaUpdate";
import "./styles.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="boot">
        <h1>เกิดข้อผิดพลาดในการเปิดแอป</h1>
        <p>{this.state.error}</p>
        <p>โน้ตที่บันทึกแล้วปลอดภัยอยู่ในบัญชีของคุณ</p>
        <button onClick={() => location.reload()}>โหลดใหม่</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
// Prompt strategy: a new version installs in the background but only activates once the
// user confirms (see pwaUpdate.ts + App.tsx's update toast) or every old tab closes.
// The desktop app serves its own bundled files, so it must not run a caching service worker.
if (!(window as unknown as { topNoteDesktop?: unknown }).topNoteDesktop) {
  const updateSW = registerSW({
    onNeedRefresh() {
      announceUpdate(updateSW);
    },
    onRegisterError() {
      /* The app stays usable; shell caching can retry on next load. */
    },
  });
}
