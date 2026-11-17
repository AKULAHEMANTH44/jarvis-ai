const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
const approvedPaths = new Set();

const ALLOWED_APPLICATIONS = {
  VS_CODE: { id: 'VS_CODE', displayName: 'Visual Studio Code', win: 'code.cmd', unix: 'code' },
  NOTEPAD: { id: 'NOTEPAD', displayName: 'Notepad', win: 'notepad.exe', unix: 'gedit' },
  CALCULATOR: { id: 'CALCULATOR', displayName: 'Calculator', win: 'calc.exe', unix: 'gnome-calculator' },
  EXPLORER: { id: 'EXPLORER', displayName: 'File Explorer', win: 'explorer.exe', unix: 'xdg-open' },
  BROWSER: { id: 'BROWSER', displayName: 'Default Browser', win: 'explorer.exe', unix: 'xdg-open' },
  CHROME: { id: 'CHROME', displayName: 'Google Chrome', win: 'chrome.exe', unix: 'google-chrome' },
  SPOTIFY: { id: 'SPOTIFY', displayName: 'Spotify', win: 'spotify.exe', unix: 'spotify' }
};

const BLOCKED_BINARIES = new Set([
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'wscript', 'wscript.exe', 'cscript', 'cscript.exe',
  'reg', 'reg.exe', 'regedit', 'regedit.exe', 'rundll32', 'rundll32.exe'
]);

const DANGEROUS_ARG_PATTERN = /[;&|`$<>\r\n\0]|^(?:\/c|-c|-e|--eval|-enc|-encodedcommand|-command)$/i;

function isTrustedSender(event) {
  try {
    const senderUrl = event?.senderFrame?.url || '';
    if (!senderUrl) return false;
    return (
      senderUrl.startsWith('http://localhost:3000') ||
      senderUrl.startsWith('http://127.0.0.1:3000') ||
      senderUrl.startsWith('file://')
    );
  } catch {
    return false;
  }
}

function validatePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return { valid: false, error: 'Path must be a non-empty string.' };
  const trimmed = rawPath.trim();
  if (!trimmed) return { valid: false, error: 'Path cannot be empty.' };
  if (trimmed.includes('\0') || /[\r\n]/.test(trimmed)) return { valid: false, error: 'Path contains prohibited control characters.' };
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed) || /(^|[\\/])\.\.([\\/]|$)/.test(decoded)) {
    return { valid: false, error: 'Path traversal (..) is strictly blocked.' };
  }
  try {
    const resolved = path.resolve(trimmed);
    if (approvedPaths.size > 0) {
      let within = false;
      for (const root of approvedPaths) {
        const normRoot = path.resolve(root);
        const prefix = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
        if (resolved === normRoot || resolved.startsWith(prefix)) {
          within = true;
          break;
        }
      }
      if (!within) {
        return { valid: false, error: 'Path is outside user-selected approved desktop paths.' };
      }
    }
    return { valid: true, resolved };
  } catch {
    return { valid: false, error: 'Invalid path format.' };
  }
}

function validateExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Only HTTP/HTTPS URLs are permitted.' };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: 'URLs containing embedded credentials are blocked.' };
    }
    return { valid: true, url: parsed.toString() };
  } catch {
    return { valid: false, error: 'Malformed external URL.' };
  }
}

async function handleLaunchApplication(applicationId, args = []) {
  if (!applicationId) return { ok: false, verified: false, error: 'MISSING_APPLICATION_ID', summary: 'Missing applicationId.' };
  const rawLower = String(applicationId).trim().toLowerCase();
  if (BLOCKED_BINARIES.has(rawLower)) {
    return { ok: false, verified: false, error: 'BLOCKED_SHELL_COMMAND', summary: `Blocked restricted binary "${applicationId}".` };
  }

  const norm = String(applicationId).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const entry = ALLOWED_APPLICATIONS[norm];
  if (!entry) {
    return {
      ok: false,
      verified: false,
      error: 'DISALLOWED_APPLICATION',
      summary: `Application "${applicationId}" is not in the allowlist.`
    };
  }

  const sanitizedArgs = Array.isArray(args)
    ? args.filter((a) => typeof a === 'string' && !DANGEROUS_ARG_PATTERN.test(a.trim()))
    : [];

  return new Promise((resolve) => {
    let settled = false;
    try {
      const isWin = process.platform === 'win32';
      const bin = isWin ? entry.win : entry.unix;
      const child = spawn(bin, sanitizedArgs, { detached: true, stdio: 'ignore', shell: false });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          resolve({
            ok: false,
            action: 'APPLICATION_LAUNCH',
            target: entry.displayName,
            verified: false,
            error: err.message,
            summary: `Failed to launch ${entry.displayName}: ${err.message}`
          });
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.unref();
          } catch {
            // ignore
          }
          resolve({
            ok: true,
            action: 'APPLICATION_LAUNCH',
            target: entry.displayName,
            verified: true,
            pid: child.pid,
            summary: `Launched ${entry.displayName}.`
          });
        }
      }, 45);
    } catch (err) {
      if (!settled) {
        settled = true;
        resolve({ ok: false, verified: false, error: err.message, summary: err.message });
      }
    }
  });
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

// IPC Handlers with strict origin + payload validation
ipcMain.handle('jarvis:selectFile', async (event) => {
  if (!isTrustedSender(event)) return { ok: false, cancelled: true, error: 'UNTRUSTED_IPC_SENDER' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Approved File for J.A.R.V.I.S.'
  });
  if (result.canceled || !result.filePaths?.length) {
    return { ok: true, cancelled: true, path: null };
  }
  const chosen = path.resolve(result.filePaths[0]);
  approvedPaths.add(chosen);
  return { ok: true, cancelled: false, path: chosen, name: path.basename(chosen) };
});

ipcMain.handle('jarvis:selectFolder', async (event) => {
  if (!isTrustedSender(event)) return { ok: false, cancelled: true, error: 'UNTRUSTED_IPC_SENDER' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Approved Project Folder for J.A.R.V.I.S.'
  });
  if (result.canceled || !result.filePaths?.length) {
    return { ok: true, cancelled: true, path: null };
  }
  const chosen = path.resolve(result.filePaths[0]);
  approvedPaths.add(chosen);
  return { ok: true, cancelled: false, path: chosen, name: path.basename(chosen) || chosen };
});

ipcMain.handle('jarvis:launchApp', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, verified: false, error: 'UNTRUSTED_IPC_SENDER', summary: 'Untrusted IPC sender.' };
  const { applicationId, args } = payload || {};
  return handleLaunchApplication(applicationId, args);
});

ipcMain.handle('jarvis:openFile', async (event, { filePath }) => {
  if (!isTrustedSender(event)) return { ok: false, verified: false, error: 'UNTRUSTED_IPC_SENDER', summary: 'Untrusted IPC sender.' };
  const val = validatePath(filePath);
  if (!val.valid) return { ok: false, verified: false, error: val.error, summary: val.error };
  if (!fs.existsSync(val.resolved)) return { ok: false, verified: false, error: 'FILE_NOT_FOUND', summary: 'File does not exist on disk.' };
  if (fs.statSync(val.resolved).isDirectory()) return { ok: false, verified: false, error: 'IS_DIRECTORY', summary: 'Target is a directory.' };

  try {
    const errStr = await shell.openPath(val.resolved);
    if (errStr) {
      return { ok: false, action: 'FILE_ACCESS', target: val.resolved, verified: false, error: errStr, summary: errStr };
    }
    return { ok: true, action: 'FILE_ACCESS', target: val.resolved, verified: true, summary: `Opened file "${path.basename(val.resolved)}".` };
  } catch (err) {
    return { ok: false, verified: false, error: err.message, summary: err.message };
  }
});

ipcMain.handle('jarvis:openFolder', async (event, { folderPath }) => {
  if (!isTrustedSender(event)) return { ok: false, verified: false, error: 'UNTRUSTED_IPC_SENDER', summary: 'Untrusted IPC sender.' };
  const val = validatePath(folderPath);
  if (!val.valid) return { ok: false, verified: false, error: val.error, summary: val.error };
  if (!fs.existsSync(val.resolved)) return { ok: false, verified: false, error: 'FOLDER_NOT_FOUND', summary: 'Folder does not exist on disk.' };
  if (!fs.statSync(val.resolved).isDirectory()) return { ok: false, verified: false, error: 'NOT_A_DIRECTORY', summary: 'Target is not a directory.' };

  try {
    const errStr = await shell.openPath(val.resolved);
    if (errStr) {
      return { ok: false, action: 'FOLDER_ACCESS', target: val.resolved, verified: false, error: errStr, summary: errStr };
    }
    return { ok: true, action: 'FOLDER_ACCESS', target: val.resolved, verified: true, summary: `Opened folder "${val.resolved}".` };
  } catch (err) {
    return { ok: false, verified: false, error: err.message, summary: err.message };
  }
});

ipcMain.handle('jarvis:openBrowser', async (event, { url }) => {
  if (!isTrustedSender(event)) return { ok: false, verified: false, error: 'UNTRUSTED_IPC_SENDER', summary: 'Untrusted IPC sender.' };
  const val = validateExternalUrl(url || 'https://www.google.com');
  if (!val.valid) return { ok: false, verified: false, error: val.error, summary: val.error };

  try {
    await shell.openExternal(val.url);
    return { ok: true, action: 'BROWSER_ACCESS', target: val.url, verified: true, summary: `Opened browser to ${val.url}.` };
  } catch (err) {
    return { ok: false, verified: false, error: err.message, summary: err.message };
  }
});

ipcMain.handle('jarvis:searchWeb', async (event, { query, engine }) => {
  if (!isTrustedSender(event)) return { ok: false, verified: false, error: 'UNTRUSTED_IPC_SENDER', summary: 'Untrusted IPC sender.' };
  const clean = String(query || '').trim();
  if (!clean) return { ok: false, verified: false, error: 'EMPTY_QUERY', summary: 'Empty search query.' };
  const encoded = encodeURIComponent(clean);
  const searchUrl =
    engine === 'duckduckgo'
      ? `https://duckduckgo.com/?q=${encoded}`
      : engine === 'bing'
      ? `https://www.bing.com/search?q=${encoded}`
      : `https://www.google.com/search?q=${encoded}`;

  try {
    await shell.openExternal(searchUrl);
    return { ok: true, action: 'WEB_SEARCH', target: clean, verified: true, summary: `Searched web for "${clean}".` };
  } catch (err) {
    return { ok: false, verified: false, error: err.message, summary: err.message };
  }
});

ipcMain.handle('jarvis:launchMusic', async (event, { musicTarget }) => {
  if (!isTrustedSender(event)) return { ok: false, verified: false, error: 'UNTRUSTED_IPC_SENDER', summary: 'Untrusted IPC sender.' };
  const target = String(musicTarget || 'SPOTIFY').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (target !== 'SPOTIFY') {
    return {
      ok: false,
      action: 'MUSIC_CONTROL',
      target: String(musicTarget || ''),
      verified: false,
      error: 'DISALLOWED_MUSIC_APPLICATION',
      summary: `Music application "${musicTarget}" is not in the approved music allowlist.`
    };
  }
  const appRes = await handleLaunchApplication('SPOTIFY');
  return { ...appRes, action: 'MUSIC_CONTROL' };
});

ipcMain.handle('jarvis:findFilesInFolder', async (event, { folderPath, filterPattern }) => {
  if (!isTrustedSender(event)) return { ok: false, files: [], error: 'UNTRUSTED_IPC_SENDER' };
  const val = validatePath(folderPath);
  if (!val.valid) return { ok: false, files: [], error: val.error };
  if (!fs.existsSync(val.resolved) || !fs.statSync(val.resolved).isDirectory()) {
    return { ok: false, files: [], error: 'Folder not found.' };
  }

  try {
    const entries = fs.readdirSync(val.resolved);
    const matched = filterPattern
      ? entries.filter((e) => e.toLowerCase().includes(String(filterPattern).toLowerCase()))
      : entries;
    return { ok: true, folder: val.resolved, files: matched.slice(0, 50) };
  } catch (err) {
    return { ok: false, files: [], error: err.message };
  }
});

ipcMain.handle('jarvis:getSystemStatus', async (event) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  return {
    ok: true,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    approvedApps: Object.keys(ALLOWED_APPLICATIONS),
    approvedPathCount: approvedPaths.size
  };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
