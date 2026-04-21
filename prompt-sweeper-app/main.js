// Prompt Sweeper — Electron main process
// Responsible for: tray lifecycle, window management, clipboard watchdog, IPC

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const { createTray, setMascotState } = require('./src/tray/tray');
const { startClipboardWatchdog, stopClipboardWatchdog } = require('./src/watchdog/clipboard');
const { scanText, hasSlop } = require('./src/engine/scanner');
const { autoFix, localRewrite } = require('./src/engine/rewriter');
const settings = require('./src/features/settings-store');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;
let isQuitting = false;

// ── App lifecycle ────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray({
    onOpenMain: openMainWindow,
    onQuit: () => { isQuitting = true; app.quit(); },
    onToggleWatchdog: toggleWatchdog,
    onOpenBatch: () => openMainWindow('batch'),
    onOpenUrlScan: () => openMainWindow('url'),
    onOpenSettings: () => openMainWindow('settings'),
  });

  if (settings.get('watchdog.enabled', true)) {
    startClipboardWatchdog({ onDetect: handleClipboardDetection });
  }

  // On macOS, dock icon should only show when window is open
  if (process.platform === 'darwin') app.dock.hide();
});

app.on('window-all-closed', (e) => {
  // Keep running in tray — don't quit on window close
  if (!isQuitting) e.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopClipboardWatchdog();
});

// ── Window management ───────────────────────────────────────────
function openMainWindow(route = 'home') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('navigate', route);
    return;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 640,
    minHeight: 500,
    backgroundColor: '#FAF7F0',
    title: 'Prompt Sweeper',
    icon: path.join(__dirname, 'assets/icons/app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  if (process.platform === 'darwin') app.dock.show();

  mainWindow.loadFile(path.join(__dirname, 'src/windows/main.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('navigate', route);
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'darwin') app.dock.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Clipboard watchdog ──────────────────────────────────────────
function toggleWatchdog(enabled) {
  settings.set('watchdog.enabled', enabled);
  if (enabled) {
    startClipboardWatchdog({ onDetect: handleClipboardDetection });
  } else {
    stopClipboardWatchdog();
    setMascotState('idle');
  }
}

function handleClipboardDetection({ text, result }) {
  setMascotState('alert');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard-detected', { text, result });
  }
  // Notification handled inside watchdog module
}

// ── IPC handlers (renderer -> main) ─────────────────────────────
ipcMain.handle('scan', (_e, text) => scanText(text));
ipcMain.handle('hasSlop', (_e, text, threshold) => hasSlop(text, threshold));
ipcMain.handle('autoFix', async (_e, text) => {
  setMascotState('eating');
  const s = settings.all();
  const result = await autoFix(text, s);
  setTimeout(() => setMascotState('full'), 300);
  setTimeout(() => setMascotState('idle'), 3500);
  return result;
});
ipcMain.handle('localRewrite', (_e, text) => localRewrite(text));

ipcMain.handle('settings.get', (_e, key) => settings.get(key));
ipcMain.handle('settings.set', (_e, key, val) => settings.set(key, val));
ipcMain.handle('settings.all', () => settings.all());

ipcMain.handle('shell.openExternal', (_e, url) => shell.openExternal(url));

// Feature stubs — implemented by their own modules
ipcMain.handle('batch.processFolder', async (_e, folderPath) => {
  const { processBatch } = require('./src/features/batch');
  return processBatch(folderPath);
});
ipcMain.handle('urlScan.generate', async (_e, url) => {
  const { scanUrlGenerateMd } = require('./src/features/url-scan');
  return scanUrlGenerateMd(url);
});
ipcMain.handle('siteWatchdog.addSite', async (_e, config) => {
  const { addWatchedSite } = require('./src/features/site-watchdog');
  return addWatchedSite(config);
});
ipcMain.handle('teamRules.import', async (_e, filePath) => {
  const { importTeamRules } = require('./src/features/team-rules');
  return importTeamRules(filePath);
});
