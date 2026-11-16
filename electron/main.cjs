const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;

const ALLOWED_APPLICATIONS = {
  VS_CODE: { id: 'VS_CODE', displayName: 'Visual Studio Code', win: 'code.cmd', unix: 'code' },
  NOTEPAD: { id: 'NOTEPAD', displayName: 'Notepad', win: 'notepad.exe', unix: 'gedit' },
  CALCULATOR: { id: 'CALCULATOR', displayName: 'Calculator', win: 'calc.exe', unix: 'gnome-calculator' },
  EXPLORER: { id: 'EXPLORER', displayName: 'File Explorer', win: 'explorer.exe', unix: 'xdg-open' },
  BROWSER: { id: 'BROWSER', displayName: 'Default Browser', win: 'explorer.exe', unix: 'xdg-open' },
  SPOTIFY: { id: 'SPOTIFY', displayName: 'Spotify', win: 'spotify.exe', unix: 'spotify' }
};

function validatePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return { valid: false, error: 'Path must be a non-empty string.' };
  const trimmed = rawPath.trim();
  if (trimmed.includes('\0') || /[\r\n]/.test(trimmed)) return { valid: false, error: 'Path contains prohibited control characters.' };
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { valid: false, error: 'Path traversal (..) is strictly blocked.' };
  try {
    return { valid: true, resolved: path.resolve(trimmed) };
  } catch (err) {
    return { valid: false, error: 'Invalid path format.' };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#02060c',
    title: 'J.A.R.V.I.S. Command Center',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const targetUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers with strict validation
ipcMain.handle('jarvis:launchApp', async (_event, payload) => {
  const { applicationId, args } = payload || {};
  if (!applicationId) return { ok: false, error: 'Missing applicationId' };

  const norm = String(applicationId).trim().toUpperCase();
  const entry = ALLOWED_APPLICATIONS[norm];
  if (!entry) {
    return { ok: false, error: `Application "${applicationId}" is not in the allowlist.` };
  }

  const sanitizedArgs = Array.isArray(args)
    ? args.filter((a) => typeof a === 'string' && !/[;&|`$<>]/.test(a))
    : [];

  try {
    const isWin = process.platform === 'win32';
    const bin = isWin ? entry.win : entry.unix;
    const child = spawn(bin, sanitizedArgs, { detached: true, stdio: 'ignore', shell: false });
    child.unref();
    return { ok: true, action: 'APPLICATION_LAUNCH', target: entry.displayName, pid: child.pid, summary: `Launched ${entry.displayName}.` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jarvis:openFile', async (_event, { filePath }) => {
  const val = validatePath(filePath);
  if (!val.valid) return { ok: false, error: val.error };
  if (!fs.existsSync(val.resolved)) return { ok: false, error: 'File does not exist on disk.' };
  if (fs.statSync(val.resolved).isDirectory()) return { ok: false, error: 'Target is a directory.' };

  try {
    await shell.openPath(val.resolved);
    return { ok: true, action: 'FILE_ACCESS', target: val.resolved, summary: `Opened file "${path.basename(val.resolved)}".` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jarvis:openFolder', async (_event, { folderPath }) => {
  const val = validatePath(folderPath);
  if (!val.valid) return { ok: false, error: val.error };
  if (!fs.existsSync(val.resolved)) return { ok: false, error: 'Folder does not exist on disk.' };
  if (!fs.statSync(val.resolved).isDirectory()) return { ok: false, error: 'Target is not a directory.' };

  try {
    await shell.openPath(val.resolved);
    return { ok: true, action: 'FOLDER_ACCESS', target: val.resolved, summary: `Opened folder "${val.resolved}".` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jarvis:openBrowser', async (_event, { url }) => {
  const targetUrl = url ? String(url).trim() : 'https://www.google.com';
  if (!/^https?:\/\//i.test(targetUrl)) return { ok: false, error: 'Invalid URL scheme.' };

  try {
    await shell.openExternal(targetUrl);
    return { ok: true, action: 'BROWSER_ACCESS', target: targetUrl, summary: `Opened browser to ${targetUrl}.` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jarvis:searchWeb', async (_event, { query, engine }) => {
  const clean = String(query || '').trim();
  if (!clean) return { ok: false, error: 'Empty query' };
  const encoded = encodeURIComponent(clean);
  const searchUrl =
    engine === 'duckduckgo'
      ? `https://duckduckgo.com/?q=${encoded}`
      : `https://www.google.com/search?q=${encoded}`;

  try {
    await shell.openExternal(searchUrl);
    return { ok: true, action: 'WEB_SEARCH', target: clean, summary: `Searched web for "${clean}".` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jarvis:launchMusic', async (_event, { musicTarget }) => {
  return ipcMain.emit('jarvis:launchApp', _event, { applicationId: 'SPOTIFY' });
});

ipcMain.handle('jarvis:findFilesInFolder', async (_event, { folderPath, filterPattern }) => {
  const val = validatePath(folderPath);
  if (!val.valid) return { ok: false, files: [], error: val.error };
  if (!fs.existsSync(val.resolved) || !fs.statSync(val.resolved).isDirectory()) {
    return { ok: false, files: [], error: 'Folder not found.' };
  }

  try {
    const entries = fs.readdirSync(val.resolved);
    const matched = filterPattern
      ? entries.filter((e) => e.toLowerCase().includes(filterPattern.toLowerCase()))
      : entries;
    return { ok: true, folder: val.resolved, files: matched.slice(0, 50) };
  } catch (err) {
    return { ok: false, files: [], error: err.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
