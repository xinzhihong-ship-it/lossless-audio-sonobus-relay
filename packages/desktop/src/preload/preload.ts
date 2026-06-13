import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopApi", {
  appVersion: () => ipcRenderer.invoke("app-version") as Promise<string>
});
