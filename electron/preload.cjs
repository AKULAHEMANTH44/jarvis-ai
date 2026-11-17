const { contextBridge, ipcRenderer } = require('electron');

/**
 * JARVIS Desktop Secure IPC Bridge
 * Exposes strictly typed and validated desktop automation APIs.
 * Does not expose Node.js primitives, fs, child_process, or arbitrary exec.
 */
contextBridge.exposeInMainWorld('jarvisDesktop', {
  isElectron: true,
  platform: process.platform,

  launchApp: async (applicationId, args = []) => {
    return ipcRenderer.invoke('jarvis:launchApp', { applicationId, args });
  },

  openFile: async (filePath) => {
    return ipcRenderer.invoke('jarvis:openFile', { filePath });
  },

  openFolder: async (folderPath) => {
    return ipcRenderer.invoke('jarvis:openFolder', { folderPath });
  },

  openBrowser: async (url) => {
    return ipcRenderer.invoke('jarvis:openBrowser', { url });
  },

  searchWeb: async (query, engine = 'google') => {
    return ipcRenderer.invoke('jarvis:searchWeb', { query, engine });
  },

  launchMusic: async (musicTarget = 'Spotify') => {
    return ipcRenderer.invoke('jarvis:launchMusic', { musicTarget });
  },

  findFilesInFolder: async (folderPath, filterPattern) => {
    return ipcRenderer.invoke('jarvis:findFilesInFolder', { folderPath, filterPattern });
  },

  selectFile: async () => {
    return ipcRenderer.invoke('jarvis:selectFile');
  },

  selectFolder: async () => {
    return ipcRenderer.invoke('jarvis:selectFolder');
  },

  getSystemStatus: async () => {
    return ipcRenderer.invoke('jarvis:getSystemStatus');
  },

  getPermissionConfig: async () => {
    return ipcRenderer.invoke('jarvis:getPermissionConfig');
  },

  savePermissionConfig: async (config) => {
    return ipcRenderer.invoke('jarvis:savePermissionConfig', config);
  },

  resetPermissionConfig: async (clearSetupCompleted = false) => {
    return ipcRenderer.invoke('jarvis:resetPermissionConfig', { clearSetupCompleted });
  },

  revokeFolderPath: async (folderPath) => {
    return ipcRenderer.invoke('jarvis:revokeFolderPath', { folderPath });
  }
});
