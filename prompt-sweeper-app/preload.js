// Preload — context bridge between Electron main and renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sweeper', {
  // Scanning
  scan: (text) => ipcRenderer.invoke('scan', text),
  hasSlop: (text, threshold) => ipcRenderer.invoke('hasSlop', text, threshold),

  // Auto-fix
  autoFix: (text) => ipcRenderer.invoke('autoFix', text),
  localRewrite: (text) => ipcRenderer.invoke('localRewrite', text),

  // Settings
  settings: {
    get: (key) => ipcRenderer.invoke('settings.get', key),
    set: (key, val) => ipcRenderer.invoke('settings.set', key, val),
    all: () => ipcRenderer.invoke('settings.all'),
  },

  // Feature stubs
  batch: {
    processFolder: (folderPath) => ipcRenderer.invoke('batch.processFolder', folderPath),
  },
  urlScan: {
    generate: (url) => ipcRenderer.invoke('urlScan.generate', url),
  },
  siteWatchdog: {
    addSite: (config) => ipcRenderer.invoke('siteWatchdog.addSite', config),
  },
  teamRules: {
    import: (filePath) => ipcRenderer.invoke('teamRules.import', filePath),
  },

  // External links
  openExternal: (url) => ipcRenderer.invoke('shell.openExternal', url),

  // Events from main -> renderer
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, route) => cb(route)),
  onClipboardDetected: (cb) => ipcRenderer.on('clipboard-detected', (_e, data) => cb(data)),
});
