// Desktop shell for Top Note.
//
// The built web app is served from a fixed loopback origin (not file://) so that:
//  - Supabase gets a stable, allow-listable redirect URL, and
//  - the OAuth PKCE verifier saved in localStorage survives between sign-in and callback.
// Google refuses OAuth inside embedded webviews, so sign-in runs in the user's real browser.
// That browser is sent back to /auth/callback on this same loopback server, which hands the
// result to the app window.
const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.TOP_NOTE_PORT) || 47831;
const ORIGIN = `http://${HOST}:${PORT}`;
const CALLBACK_PATH = "/auth/callback";
const DIST = path.join(__dirname, "..", "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let win = null;

function serveFile(res, file) {
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  });
}

function handle(req, res) {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname === CALLBACK_PATH) {
    // Reached by the system browser after Google/Supabase finish. Forward the code (or the
    // error) to the app window, which owns the PKCE verifier and completes the exchange.
    if (win) {
      win.loadURL(`${ORIGIN}/${url.search}`);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>Top Note</title>
       <body style="font-family:sans-serif;background:#0d0b14;color:#f3effa;text-align:center;padding-top:20vh">
       <h1>เสร็จแล้ว</h1><p>กลับไปที่แอป Top Note ได้เลย ปิดแท็บนี้ได้</p>`,
    );
    return;
  }
  // Static files from dist/, with SPA fallback. Resolve inside DIST only.
  const target = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (target !== DIST && !target.startsWith(DIST + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(target, (err, stat) =>
    serveFile(res, !err && stat.isFile() ? target : path.join(DIST, "index.html")),
  );
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: "#0d0b14",
    title: "Top Note",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Links that leave the app open in the real browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  win.on("closed", () => (win = null));
  void win.loadURL(`${ORIGIN}/`);
}

ipcMain.on("top-note:open-external", (_event, url) => {
  // Only web URLs; the renderer must never be able to launch arbitrary protocols.
  if (typeof url === "string" && /^https:\/\//.test(url)) void shell.openExternal(url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      await startServer();
    } catch (e) {
      dialog.showErrorBox(
        "เปิด Top Note ไม่ได้",
        `พอร์ต ${PORT} ถูกใช้งานอยู่ (${e.code || e.message}) ปิดโปรแกรมที่ใช้พอร์ตนี้แล้วลองใหม่`,
      );
      app.quit();
      return;
    }
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
