import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getConfigDir: () => ipcRenderer.invoke('app:get-config-dir'),
  loadConfig: (workspace: string) => ipcRenderer.invoke('app:load-config', workspace),
  getRecentWorkspaces: () => ipcRenderer.invoke('app:get-recent-workspaces'),
  addRecentWorkspace: (workspace: string) => ipcRenderer.invoke('app:add-recent-workspace', workspace),
  pickWorkspace: () => ipcRenderer.invoke('app:pick-workspace'),
  encrypt: (data: string) => ipcRenderer.invoke('app:encrypt', data),
  decrypt: (encryptedBase64: string) => ipcRenderer.invoke('app:decrypt', encryptedBase64),
  agent: {
    create: (options: any) => ipcRenderer.invoke('agent:create', options),
    run: (id: number, input: string) => ipcRenderer.invoke('agent:run', id, input),
    abort: (id: number) => ipcRenderer.send('agent:abort', id),
    destroy: (id: number) => ipcRenderer.invoke('agent:destroy', id),
    getMessages: (id: number) => ipcRenderer.invoke('agent:get-messages', id),
    onEvent: (id: number, callback: (event: any) => void) => {
      const channel = `agent:event:${id}`;
      ipcRenderer.on(channel, (_e, event) => callback(event));
      return () => ipcRenderer.off(channel, (_e, event) => callback(event));
    },
  },
  fs: {
    read: (workspace: string, path: string) => ipcRenderer.invoke('fs:read', workspace, path),
    write: (workspace: string, path: string, content: string) => ipcRenderer.invoke('fs:write', workspace, path, content),
    list: (workspace: string, path: string) => ipcRenderer.invoke('fs:list', workspace, path),
  },
  shell: {
    execute: (workspace: string, command: string, args: string[]) => ipcRenderer.invoke('shell:execute', workspace, command, args),
  },
});