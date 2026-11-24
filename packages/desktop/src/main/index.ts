import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent, type AgentHandle, type CreateAgentOptions } from '@coded/core/desktop/desktop-agent.js';
import { loadConfig } from '@coded/core';
import { configDir, normalizeWorkspace, resolveInside } from '@coded/core/utils/paths.js';
import Store from 'electron-store';
import { safeStorage } from 'electron';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const store = new Store<{
  windowState: WindowState;
  config: Record<string, unknown>;
  recentWorkspaces: string[];
}>({
  name: 'coded-desktop',
  defaults: {
    windowState: { width: 1200, height: 800, maximized: false },
    config: {},
    recentWorkspaces: [],
  },
});

// Type-safe accessors
function getStoreValue<T>(key: string): T {
  return store.get(key) as T;
}

function setStoreValue(key: string, value: unknown): void {
  store.set(key, value);
}

let mainWindow: BrowserWindow | null = null;
const agents = new Map<number, AgentHandle>();

(globalThis as any).__codedAgents = new Map();
const desktopAgents = (globalThis as any).__codedAgents as Map<number, any>;

function createWindow(): BrowserWindow {
  const { width, height, maximized, x, y } = getStoreValue<WindowState>('windowState');
  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    },
  });

  if (maximized) mainWindow.maximize();

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('close', () => {
    const bounds = mainWindow?.getBounds();
    if (bounds) {
      setStoreValue('windowState', {
        ...bounds,
        maximized: mainWindow?.isMaximized() ?? false,
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'"] } });
  });
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const ok = navigationUrl.startsWith('file://');
    if (!ok) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).protocol === 'https:') void shell.openExternal(url); } catch {}
    return { action: 'deny' } as const;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('app:get-config-dir', () => configDir());

ipcMain.handle('app:load-config', async (_event, workspace: string) => {
  try {
    return loadConfig({ workspace: normalizeWorkspace(workspace) });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle('app:save-config', async () => {
  return { success: true };
});

ipcMain.handle('app:get-recent-workspaces', () => getStoreValue<string[]>('recentWorkspaces'));

ipcMain.handle('app:add-recent-workspace', (_event, workspace: string) => {
  const list = getStoreValue<string[]>('recentWorkspaces');
  const normalized = normalizeWorkspace(workspace);
  const filtered = list.filter((w) => w !== normalized);
  filtered.unshift(normalized);
  setStoreValue('recentWorkspaces', filtered.slice(0, 10));
});

ipcMain.handle('app:pick-workspace', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Workspace',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('app:encrypt', async (_event, data: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available');
  }
  return safeStorage.encryptString(data).toString('base64');
});

ipcMain.handle('app:decrypt', async (_event, encryptedBase64: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available');
  }
  return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'));
});

ipcMain.handle('agent:create', async (_event, options: CreateAgentOptions) => {
  const handle = createAgent({
    ...options,
    onEvent: (event: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`agent:event:${handle.id}`, event);
      }
    },
  });
  agents.set(handle.id, handle);
  desktopAgents.set(handle.id, handle.agent);
  return { id: handle.id };
});

ipcMain.handle('agent:run', async (_event, agentId: number, input: string) => {
  const handle = agents.get(agentId);
  return handle?.run(input);
});

ipcMain.on('agent:abort', (_event, agentId: number) => {
  const handle = agents.get(agentId);
  handle?.abort();
});

ipcMain.handle('agent:destroy', async (_event, agentId: number) => {
  const handle = agents.get(agentId);
  if (handle) {
    await handle.destroy();
    agents.delete(agentId);
    desktopAgents.delete(agentId);
  }
});

ipcMain.handle('agent:get-messages', async (_event, agentId: number) => {
  const handle = agents.get(agentId);
  return handle?.getMessages() ?? [];
});

ipcMain.handle('agent:answer-permission', async (_event, agentId: number, answer: 'allow' | 'always' | 'deny') => {
  const agent = desktopAgents.get(agentId);
  agent?.answerPermission(answer);
});

ipcMain.handle('fs:read', async (_event, workspace: string, path: string) => {
  const { readFile } = await import('node:fs/promises');
  const fullPath = resolveInside(normalizeWorkspace(workspace), path);
  return readFile(fullPath, 'utf8');
});

ipcMain.handle('fs:write', async (_event, workspace: string, path: string, content: string) => {
  const { writeFile } = await import('node:fs/promises');
  const fullPath = resolveInside(normalizeWorkspace(workspace), path);
  await writeFile(fullPath, content, 'utf8');
});

ipcMain.handle('fs:list', async (_event, workspace: string, path: string) => {
  const { readdir } = await import('node:fs/promises');
  const fullPath = resolveInside(normalizeWorkspace(workspace), path);
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    isFile: e.isFile(),
  }));
});

ipcMain.handle('shell:execute', async (_event, workspace: string, command: string, args: string[]) => {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd: normalizeWorkspace(workspace), shell: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
});
