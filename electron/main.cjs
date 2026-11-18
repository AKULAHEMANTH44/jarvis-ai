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

const BLOCKED_FILE_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'ps1', 'sh', 'vbs', 'vbe', 'dll', 'sys', 'com', 'app', 'dmg', 'pkg', 'deb', 'rpm'
]);

const inFlightLaunches = new Set();

const DANGEROUS_ARG_PATTERN = /[;&|`$<>\r\n\0]|^(?:\/c|-c|-e|--eval|-enc|-encodedcommand|-command)(?:$|[=\s:])/i;

const CAPABILITY_IDS = [
  'APPLICATION_ACCESS',
  'BROWSER_ACCESS',
  'FOLDER_ACCESS',
  'MUSIC_ACCESS',
  'CAMERA_ACCESS',
  'MICROPHONE_ACCESS'
];

function createDefaultPermissionConfig() {
  return {
    version: 1,
    setupCompleted: false,
    setupCompletedAt: null,
    capabilities: {
      APPLICATION_ACCESS: { id: 'APPLICATION_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      BROWSER_ACCESS: { id: 'BROWSER_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      FOLDER_ACCESS: { id: 'FOLDER_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      MUSIC_ACCESS: { id: 'MUSIC_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      CAMERA_ACCESS: { id: 'CAMERA_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      MICROPHONE_ACCESS: { id: 'MICROPHONE_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null }
    },
    allowedAppIds: {
      VS_CODE: true,
      NOTEPAD: true,
      CALCULATOR: true,
      EXPLORER: true,
      BROWSER: true,
      CHROME: true,
      SPOTIFY: true
    },
    approvedFolders: []
  };
}

let permissionConfig = createDefaultPermissionConfig();

function getPermissionStorePath() {
  try {
    return path.join(app.getPath('userData'), 'jarvis-permissions.json');
  } catch {
    return null;
  }
}

function sanitizePermissionConfig(raw) {
  const def = createDefaultPermissionConfig();
  if (!raw || typeof raw !== 'object') return def;

  const capabilities = { ...def.capabilities };
  if (raw.capabilities && typeof raw.capabilities === 'object') {
    for (const id of CAPABILITY_IDS) {
      const entry = raw.capabilities[id];
      if (
        entry &&
        typeof entry === 'object' &&
        (entry.decision === 'NOT_REQUESTED' || entry.decision === 'GRANTED' || entry.decision === 'DENIED')
      ) {
        capabilities[id] = {
          id,
          decision: entry.decision,
          updatedAt:
            typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : null
        };
      }
    }
  }

  const allowedAppIds = { ...def.allowedAppIds };
  if (raw.allowedAppIds && typeof raw.allowedAppIds === 'object') {
    for (const [k, v] of Object.entries(raw.allowedAppIds)) {
      if (typeof v === 'boolean') {
        allowedAppIds[String(k).toUpperCase().replace(/[\s-]+/g, '_')] = v;
      }
    }
  }

  const approvedFolders = [];
  const seen = new Set();
  if (Array.isArray(raw.approvedFolders)) {
    for (const item of raw.approvedFolders) {
      if (!item || typeof item !== 'object') continue;
      const cleanPath = typeof item.path === 'string' ? item.path.trim() : '';
      if (!cleanPath || /(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(cleanPath) || cleanPath.includes('\0')) {
        continue;
      }
      const resolved = path.resolve(cleanPath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      approvedFolders.push({
        path: resolved,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : path.basename(resolved) || resolved,
        grantedAt:
          typeof item.grantedAt === 'number' && Number.isFinite(item.grantedAt)
            ? item.grantedAt
            : Date.now()
      });
    }
  }

  return {
    version: 1,
    setupCompleted: Boolean(raw.setupCompleted),
    setupCompletedAt:
      typeof raw.setupCompletedAt === 'number' && Number.isFinite(raw.setupCompletedAt)
        ? raw.setupCompletedAt
        : null,
    capabilities,
    allowedAppIds,
    approvedFolders
  };
}

function syncApprovedPathsFromPolicy() {
  for (const folder of permissionConfig.approvedFolders) {
    approvedPaths.add(path.resolve(folder.path));
  }
}

function loadPermissionConfigFromDisk() {
  const storePath = getPermissionStorePath();
  if (!storePath) return;
  try {
    if (fs.existsSync(storePath)) {
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      permissionConfig = sanitizePermissionConfig(raw);
      syncApprovedPathsFromPolicy();
    }
  } catch {
    permissionConfig = createDefaultPermissionConfig();
  }
}

function savePermissionConfigToDisk() {
  const storePath = getPermissionStorePath();
  if (!storePath) return;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(permissionConfig, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
  } catch {
    // Non-fatal fallback
  }
}

function isTrustedSender(event) {
  try {
    const senderUrl = event?.senderFrame?.url || '';
    if (!senderUrl) return false;
    const parsed = new URL(senderUrl);
    if (parsed.protocol === 'file:') return true;
    return (
      parsed.origin === 'http://localhost:3000' ||
      parsed.origin === 'http://127.0.0.1:3000'
    );
  } catch {
    return false;
  }
}

function resolveRealIfExists(targetPath) {
  const resolved = path.resolve(targetPath);
  try {
    if (fs.existsSync(resolved)) {
      return fs.realpathSync(resolved);
    }
    const parent = path.dirname(resolved);
    if (fs.existsSync(parent)) {
      return path.join(fs.realpathSync(parent), path.basename(resolved));
    }
  } catch {
    // Fallback to resolved path
  }
  return resolved;
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
    const resolved = resolveRealIfExists(trimmed);
    if (approvedPaths.size > 0) {
      let within = false;
      for (const root of approvedPaths) {
        const normRoot = resolveRealIfExists(root);
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
  if (permissionConfig.capabilities?.APPLICATION_ACCESS?.decision === 'DENIED') {
    return {
      ok: false,
      action: 'APPLICATION_LAUNCH',
      target: norm,
      verified: false,
      error: 'PERMISSION_DENIED_BY_POLICY',
      summary: 'Application Access is disabled in JARVIS persistent permissions.'
    };
  }
  if (permissionConfig.allowedAppIds && permissionConfig.allowedAppIds[norm] === false) {
    return {
      ok: false,
      action: 'APPLICATION_LAUNCH',
      target: norm,
      verified: false,
      error: 'PERMISSION_DENIED_BY_POLICY',
      summary: `Application "${norm}" is disabled in JARVIS Application Access settings.`
    };
  }

  const entry = ALLOWED_APPLICATIONS[norm];
  if (!entry) {
    return {
      ok: false,
      verified: false,
      error: 'DISALLOWED_APPLICATION',
      summary: `Application "${applicationId}" is not in the allowlist.`
    };
  }

  if (inFlightLaunches.has(entry.id)) {
    return {
      ok: false,
      action: 'APPLICATION_LAUNCH',
      target: entry.displayName,
      verified: false,
      error: 'CONCURRENT_LAUNCH_IN_PROGRESS',
      summary: `${entry.displayName} launch is already in progress.`
    };
  }

  const sanitizedArgs = Array.isArray(args)
    ? args.filter((a) => typeof a === 'string' && !DANGEROUS_ARG_PATTERN.test(a.trim()))
    : [];

  inFlightLaunches.add(entry.id);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      inFlightLaunches.delete(entry.id);
      resolve(payload);
    };
    try {
      const isWin = process.platform === 'win32';
      const bin = isWin ? entry.win : entry.unix;
      const child = spawn(bin, sanitizedArgs, { detached: true, stdio: 'ignore', shell: false });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          finish({
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
          finish({
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
        finish({ ok: false, verified: false, error: err.message, summary: err.message });
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
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return {
      ok: false,
      action: 'FILE_ACCESS',
      target: String(filePath || ''),
      verified: false,
      error: 'PERMISSION_DENIED_BY_POLICY',
      summary: 'Folder & File Access is disabled in JARVIS persistent permissions.'
    };
  }
  const val = validatePath(filePath);
  if (!val.valid) return { ok: false, verified: false, error: val.error, summary: val.error };
  if (isDevSecretFile(val.resolved)) {
    return { ok: false, verified: false, error: 'SECRET_FILE_BLOCKED', summary: 'Opening secret or credential files is blocked for safety.' };
  }
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
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return {
      ok: false,
      action: 'FOLDER_ACCESS',
      target: String(folderPath || ''),
      verified: false,
      error: 'PERMISSION_DENIED_BY_POLICY',
      summary: 'Folder Access is disabled in JARVIS persistent permissions.'
    };
  }
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
  if (permissionConfig.capabilities?.BROWSER_ACCESS?.decision === 'DENIED') {
    return {
      ok: false,
      action: 'BROWSER_ACCESS',
      target: String(url || ''),
      verified: false,
      error: 'PERMISSION_DENIED_BY_POLICY',
      summary: 'Browser Access is disabled in JARVIS persistent permissions.'
    };
  }
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
  if (permissionConfig.capabilities?.BROWSER_ACCESS?.decision === 'DENIED') {
    return {
      ok: false,
      action: 'WEB_SEARCH',
      target: String(query || ''),
      verified: false,
      error: 'PERMISSION_DENIED_BY_POLICY',
      summary: 'Browser & Web Search Access is disabled in JARVIS persistent permissions.'
    };
  }
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
  if (permissionConfig.capabilities?.MUSIC_ACCESS?.decision === 'DENIED') {
    return {
      ok: false,
      action: 'MUSIC_CONTROL',
      target: String(musicTarget || 'SPOTIFY'),
      verified: false,
      error: 'PERMISSION_DENIED_BY_POLICY',
      summary: 'Music Access is disabled in JARVIS persistent permissions.'
    };
  }
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

ipcMain.handle('jarvis:getPermissionConfig', async (event) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  return { ok: true, config: permissionConfig };
});

ipcMain.handle('jarvis:savePermissionConfig', async (event, rawConfig) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  permissionConfig = sanitizePermissionConfig(rawConfig);
  approvedPaths.clear();
  syncApprovedPathsFromPolicy();
  savePermissionConfigToDisk();
  return { ok: true, config: permissionConfig };
});

ipcMain.handle('jarvis:resetPermissionConfig', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  const clearSetup = Boolean(payload?.clearSetupCompleted);
  permissionConfig = createDefaultPermissionConfig();
  if (!clearSetup) {
    permissionConfig.setupCompleted = true;
    permissionConfig.setupCompletedAt = Date.now();
  }
  approvedPaths.clear();
  savePermissionConfigToDisk();
  return { ok: true, config: permissionConfig };
});

ipcMain.handle('jarvis:revokeFolderPath', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  const rawPath = typeof payload?.folderPath === 'string' ? payload.folderPath.trim() : '';
  if (!rawPath) return { ok: false, error: 'MISSING_PATH' };
  const resolved = path.resolve(rawPath);
  approvedPaths.delete(resolved);
  approvedPaths.delete(rawPath);
  permissionConfig.approvedFolders = permissionConfig.approvedFolders.filter(
    (f) => path.resolve(f.path) !== resolved && f.path !== rawPath
  );
  savePermissionConfigToDisk();
  return { ok: true, config: permissionConfig };
});

ipcMain.handle('jarvis:getSystemStatus', async (event) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  return {
    ok: true,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    approvedApps: Object.keys(ALLOWED_APPLICATIONS),
    approvedPathCount: approvedPaths.size,
    setupCompleted: permissionConfig.setupCompleted
  };
});

ipcMain.handle('jarvis:discoverApps', async (event) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  const apps = Object.values(ALLOWED_APPLICATIONS).map((app) => ({
    ...app,
    available: true,
    status: 'AVAILABLE'
  }));
  return { ok: true, applications: apps };
});

ipcMain.handle('jarvis:listFolder', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, items: [], error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, items: [], error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const { folderPath } = payload || {};
  const val = validatePath(folderPath);
  if (!val.valid) return { ok: false, items: [], error: val.error };
  if (!fs.existsSync(val.resolved) || !fs.statSync(val.resolved).isDirectory()) {
    return { ok: false, items: [], error: 'Folder not found or is not a directory.' };
  }
  try {
    const names = fs.readdirSync(val.resolved);
    const items = [];
    for (const name of names.slice(0, 100)) {
      try {
        const full = path.join(val.resolved, name);
        const stat = fs.statSync(full);
        const ext = path.extname(name).replace(/^\./, '').toLowerCase();
        items.push({
          name,
          path: full,
          isDirectory: stat.isDirectory(),
          sizeBytes: stat.size,
          modifiedTime: stat.mtimeMs,
          extension: ext
        });
      } catch {
        // skip
      }
    }
    return { ok: true, folder: val.resolved, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
});

const DEV_SECRET_PATTERNS = [/^\.env($|\.)/i, /^secrets?(\..*)?\.json$/i, /^credentials?(\..*)?\.json$/i, /service[-_]?account.*\.json$/i, /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i, /^\.(npmrc|pypirc|netrc)$/i];
const DEV_SECRET_EXTS = new Set(['pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'kdbx']);
const DEV_ALLOWED_TOOLS = new Set(['npm', 'npx', 'node', 'python', 'pytest', 'tsc', 'git']);
const devBackups = new Map();
const devRunningTasks = new Map();

function isDevSecretFile(p) {
  const base = path.basename(String(p || ''));
  const ext = path.extname(base).replace(/^\./, '').toLowerCase();
  return DEV_SECRET_PATTERNS.some((re) => re.test(base)) || DEV_SECRET_EXTS.has(ext);
}

ipcMain.handle('jarvis:readFile', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const { filePath } = payload || {};
  const val = validatePath(filePath);
  if (!val.valid) return { ok: false, error: val.error };
  if (isDevSecretFile(val.resolved)) return { ok: false, error: 'SECRET_FILE_BLOCKED' };
  if (!fs.existsSync(val.resolved)) return { ok: false, error: 'FILE_NOT_FOUND' };
  const stat = fs.statSync(val.resolved);
  if (stat.isDirectory()) return { ok: false, error: 'IS_DIRECTORY' };
  const ext = path.extname(val.resolved).replace(/^\./, '').toLowerCase();
  if (BLOCKED_FILE_EXTENSIONS.has(ext) || BLOCKED_BINARIES.has(ext)) {
    return { ok: false, error: 'BLOCKED_EXTENSION' };
  }
  if (stat.size > 5 * 1024 * 1024) {
    return { ok: false, error: 'FILE_TOO_LARGE' };
  }
  try {
    const content = fs.readFileSync(val.resolved, 'utf8');
    return { ok: true, path: val.resolved, name: path.basename(val.resolved), content, sizeBytes: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jarvis:createFile', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const { filePath, content, overwrite } = payload || {};
  const val = validatePath(filePath);
  if (!val.valid) return { ok: false, error: val.error };
  if (isDevSecretFile(val.resolved)) return { ok: false, error: 'SECRET_FILE_BLOCKED' };
  const ext = path.extname(val.resolved).replace(/^\./, '').toLowerCase();
  if (BLOCKED_FILE_EXTENSIONS.has(ext) || BLOCKED_BINARIES.has(ext)) {
    return { ok: false, error: 'BLOCKED_EXTENSION' };
  }
  if (fs.existsSync(val.resolved) && !overwrite) {
    return { ok: false, exists: true, error: 'FILE_ALREADY_EXISTS' };
  }
  try {
    fs.writeFileSync(val.resolved, String(content || ''), { encoding: 'utf8', mode: 0o644 });
    return { ok: true, path: val.resolved, name: path.basename(val.resolved) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Batch 5 — Electron Dev Studio Secure IPC Handlers
ipcMain.handle('jarvis:devInspectProject', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const { projectPath } = payload || {};
  const val = validatePath(projectPath);
  if (!val.valid) return { ok: false, error: val.error };
  if (!fs.existsSync(val.resolved) || !fs.statSync(val.resolved).isDirectory()) {
    return { ok: false, error: 'FOLDER_NOT_FOUND' };
  }
  const files = [];
  const excludedSecretFiles = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv']);
  const walk = (dir, depth) => {
    if (depth > 6 || files.length >= 300) return;
    for (const name of fs.readdirSync(dir)) {
      if (files.length >= 300) break;
      const full = path.join(dir, name);
      const rel = path.relative(val.resolved, full).replace(/\\/g, '/');
      const lstat = fs.lstatSync(full);
      if (lstat.isSymbolicLink()) continue;
      if (lstat.isDirectory()) {
        if (!skipDirs.has(name)) walk(full, depth + 1);
      } else if (isDevSecretFile(full)) {
        excludedSecretFiles.push(rel);
      } else {
        files.push({
          name,
          relativePath: rel,
          fullPath: full,
          isDirectory: false,
          sizeBytes: lstat.size,
          extension: path.extname(name).replace(/^\./, '').toLowerCase()
        });
      }
    }
  };
  walk(val.resolved, 0);
  return { ok: true, projectPath: val.resolved, projectName: path.basename(val.resolved), files, excludedSecretFiles, totalFilesScanned: files.length };
});

ipcMain.handle('jarvis:devReadSource', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const { projectPath, filePath } = payload || {};
  const projVal = validatePath(projectPath);
  if (!projVal.valid) return { ok: false, error: projVal.error };
  const target = path.isAbsolute(String(filePath || '')) ? String(filePath) : path.join(projVal.resolved, String(filePath || ''));
  const fileVal = validatePath(target);
  if (!fileVal.valid) return { ok: false, error: fileVal.error };
  const prefix = projVal.resolved.endsWith(path.sep) ? projVal.resolved : `${projVal.resolved}${path.sep}`;
  if (fileVal.resolved !== projVal.resolved && !fileVal.resolved.startsWith(prefix)) {
    return { ok: false, error: 'OUTSIDE_PROJECT_ROOT' };
  }
  if (isDevSecretFile(fileVal.resolved)) return { ok: false, error: 'SECRET_FILE_BLOCKED' };
  const ext = path.extname(fileVal.resolved).replace(/^\./, '').toLowerCase();
  if (BLOCKED_FILE_EXTENSIONS.has(ext)) return { ok: false, error: 'BLOCKED_EXTENSION' };
  if (!fs.existsSync(fileVal.resolved)) return { ok: false, error: 'FILE_NOT_FOUND' };
  const stat = fs.statSync(fileVal.resolved);
  if (stat.size > 512 * 1024) return { ok: false, error: 'FILE_TOO_LARGE' };
  const content = fs.readFileSync(fileVal.resolved, 'utf8');
  return { ok: true, path: fileVal.resolved, relativePath: path.relative(projVal.resolved, fileVal.resolved).replace(/\\/g, '/'), name: path.basename(fileVal.resolved), content, sizeBytes: stat.size, lineCount: content.split(/\r?\n/).length };
});

ipcMain.handle('jarvis:devApplyPatch', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const { projectPath, filePath, proposedContent, overwrite } = payload || {};
  const projVal = validatePath(projectPath);
  if (!projVal.valid) return { ok: false, error: projVal.error };
  const target = path.isAbsolute(String(filePath || '')) ? String(filePath) : path.join(projVal.resolved, String(filePath || ''));
  const fileVal = validatePath(target);
  if (!fileVal.valid) return { ok: false, error: fileVal.error };
  const prefix = projVal.resolved.endsWith(path.sep) ? projVal.resolved : `${projVal.resolved}${path.sep}`;
  if (!fileVal.resolved.startsWith(prefix)) return { ok: false, error: 'OUTSIDE_PROJECT_ROOT' };
  if (isDevSecretFile(fileVal.resolved)) return { ok: false, error: 'SECRET_FILE_BLOCKED' };
  const ext = path.extname(fileVal.resolved).replace(/^\./, '').toLowerCase();
  if (BLOCKED_FILE_EXTENSIONS.has(ext)) return { ok: false, error: 'BLOCKED_EXTENSION' };
  const existed = fs.existsSync(fileVal.resolved);
  if (existed && !overwrite) return { ok: false, error: 'FILE_ALREADY_EXISTS' };
  const originalContent = existed ? fs.readFileSync(fileVal.resolved, 'utf8') : null;
  const patchId = `epatch-${Date.now().toString(36)}`;
  devBackups.set(patchId, { patchId, filePath: fileVal.resolved, existedBefore: existed, originalContent, rolledBack: false });
  fs.mkdirSync(path.dirname(fileVal.resolved), { recursive: true });
  fs.writeFileSync(fileVal.resolved, String(proposedContent || ''), { encoding: 'utf8', mode: 0o644 });
  return { ok: true, patchId, filePath: fileVal.resolved, existedBefore: existed };
});

ipcMain.handle('jarvis:devRollbackPatch', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const rec = devBackups.get(payload?.patchId);
  if (!rec || rec.rolledBack) return { ok: false, error: 'BACKUP_NOT_FOUND_OR_USED' };
  const val = validatePath(rec.filePath);
  if (!val.valid) return { ok: false, error: val.error || 'ROLLBACK_PATH_NO_LONGER_AUTHORIZED' };
  if (isDevSecretFile(val.resolved)) return { ok: false, error: 'SECRET_FILE_BLOCKED' };
  if (rec.existedBefore && rec.originalContent !== null) {
    fs.writeFileSync(val.resolved, rec.originalContent, { encoding: 'utf8', mode: 0o644 });
  } else if (fs.existsSync(val.resolved)) {
    fs.unlinkSync(val.resolved);
  }
  rec.rolledBack = true;
  return { ok: true, patchId: rec.patchId, filePath: val.resolved };
});

ipcMain.handle('jarvis:devRunCommand', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  if (permissionConfig.capabilities?.FOLDER_ACCESS?.decision === 'DENIED') {
    return { ok: false, error: 'PERMISSION_DENIED_BY_POLICY' };
  }
  const { projectPath, tool, args, taskId } = payload || {};
  const val = validatePath(projectPath);
  if (!val.valid) return { ok: false, error: val.error };
  const normTool = String(tool || '').trim().toLowerCase();
  if (!DEV_ALLOWED_TOOLS.has(normTool)) return { ok: false, error: 'DISALLOWED_DEV_TOOL' };
  const safeArgs = Array.isArray(args) ? args.map(String) : [];
  if (safeArgs.some((a) => DANGEROUS_ARG_PATTERN.test(a) || /(^|[\\/])\.\.([\\/]|$)/.test(a))) {
    return { ok: false, error: 'UNSAFE_ARGUMENT' };
  }
  const id = taskId || `edev-${Date.now().toString(36)}`;
  const exe = process.platform === 'win32' && (normTool === 'npm' || normTool === 'npx' || normTool === 'tsc') ? `${normTool}.cmd` : normTool;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(exe, safeArgs, { cwd: val.resolved, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    devRunningTasks.set(id, { child, cancelled: false });
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 30000);
    child.stdout?.on('data', (d) => { if (stdout.length < 65536) stdout += d.toString(); });
    child.stderr?.on('data', (d) => { if (stderr.length < 65536) stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const rec = devRunningTasks.get(id);
      devRunningTasks.delete(id);
      resolve({ ok: !rec?.cancelled && code === 0, taskId: id, exitCode: code, cancelled: Boolean(rec?.cancelled), stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      devRunningTasks.delete(id);
      resolve({ ok: false, taskId: id, exitCode: null, stdout, stderr, error: err.message });
    });
  });
});

ipcMain.handle('jarvis:devCancelCommand', async (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'UNTRUSTED_IPC_SENDER' };
  const rec = devRunningTasks.get(payload?.taskId);
  if (!rec) return { ok: false };
  rec.cancelled = true;
  try { rec.child.kill('SIGTERM'); } catch {}
  return { ok: true };
});

app.whenReady().then(() => {
  loadPermissionConfigFromDisk();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
