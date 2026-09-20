const { contextBridge, ipcRenderer } = require("electron");

// The only capabilities the web app gets from the desktop shell.
contextBridge.exposeInMainWorld("topNoteDesktop", {
  callbackUrl: `${location.origin}/auth/callback`,
  openExternal: (url) => ipcRenderer.send("top-note:open-external", url),
});
