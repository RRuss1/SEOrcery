// Menu-bar / system-tray mascot — The Slop Hog
// States: idle (sleeping), alert (ears perked), eating (chomping), full (belly)

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const settings = require('../features/settings-store');

let tray = null;
let currentState = 'idle';
let animationInterval = null;
let callbacks = {};

const STATES = ['idle', 'alert', 'eating', 'full'];

function iconPath(state) {
  // On macOS, use Template images (they auto-adapt to menu bar theme)
  const suffix = process.platform === 'darwin' ? 'Template' : '';
  return path.join(__dirname, '..', '..', 'assets', 'mascot', `${state}${suffix}.png`);
}

function loadIcon(state) {
  const img = nativeImage.createFromPath(iconPath(state));
  if (img.isEmpty()) {
    // Fallback — 16x16 blank — prevents crash until art assets are added
    return nativeImage.createEmpty();
  }
  if (process.platform === 'darwin') {
    img.setTemplateImage(true);
  }
  return img.resize({ width: 18, height: 18 });
}

function createTray(cbs) {
  callbacks = cbs;
  tray = new Tray(loadIcon('idle'));
  tray.setToolTip('Prompt Sweeper — Slop Hog is watching');

  tray.on('click', () => callbacks.onOpenMain?.());

  refreshMenu();
  return tray;
}

function refreshMenu() {
  const watchdogEnabled = settings.get('watchdog.enabled', true);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Prompt Sweeper',
      enabled: false,
    },
    {
      label: getMascotStatus(),
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Prompt Sweeper',
      click: () => callbacks.onOpenMain?.(),
    },
    { type: 'separator' },
    {
      label: 'Slop Hog (Clipboard Watchdog)',
      type: 'checkbox',
      checked: watchdogEnabled,
      click: (item) => callbacks.onToggleWatchdog?.(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Batch Scan Folder...',
      click: () => callbacks.onOpenBatch?.(),
    },
    {
      label: 'Scan URL...',
      click: () => callbacks.onOpenUrlScan?.(),
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => callbacks.onOpenSettings?.(),
    },
    { type: 'separator' },
    {
      label: 'Quit Prompt Sweeper',
      click: () => callbacks.onQuit?.(),
    },
  ]);
  tray.setContextMenu(menu);
}

function getMascotStatus() {
  return {
    idle:   'Slop Hog: sleeping...',
    alert:  'Slop Hog: snorted! slop detected',
    eating: 'Slop Hog: chomping...',
    full:   'Slop Hog: belly full',
  }[currentState] || 'Slop Hog: watching';
}

/**
 * Set the mascot state. Triggers icon swap and tooltip update.
 * States:
 *   - idle:    sleeping pig (default)
 *   - alert:   ears perked, slop detected
 *   - eating:  animated chomping during auto-fix
 *   - full:    post-scan, belly full
 */
function setMascotState(state) {
  if (!STATES.includes(state)) return;
  if (!tray) return;

  currentState = state;
  stopAnimation();

  if (state === 'eating') {
    // Chomp animation: swap between eating frames
    let toggle = false;
    animationInterval = setInterval(() => {
      toggle = !toggle;
      tray.setImage(loadIcon(toggle ? 'eating' : 'alert'));
    }, 250);
  } else {
    tray.setImage(loadIcon(state));
  }

  tray.setToolTip(`Prompt Sweeper — ${getMascotStatus()}`);
  refreshMenu();
}

function stopAnimation() {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
}

function destroyTray() {
  stopAnimation();
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { createTray, setMascotState, destroyTray, refreshMenu };
