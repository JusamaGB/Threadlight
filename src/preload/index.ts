import { contextBridge, ipcRenderer } from 'electron'

import { IPC, type ThreadlightApi } from '../shared/ipc'

// The renderer has no Node access. This object is the only door between them,
// and each method maps to exactly one IPC channel.
const api: ThreadlightApi = {
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),
}

contextBridge.exposeInMainWorld('threadlight', api)
