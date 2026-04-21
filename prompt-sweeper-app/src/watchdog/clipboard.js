// Clipboard watchdog — Slop Hog sniffs the clipboard
// Polls clipboard on interval; when new text appears, silently scans for slop.
// On detection, fires a notification. Click the notification to auto-clean.

const { clipboard, Notification, nativeImage } = require('electron');
const path = require('path');
const { scanText, hasSlop } = require('../engine/scanner');
const { localRewrite } = require('../engine/rewriter');
const settings = require('../features/settings-store');

const POLL_MS = 800;
const MIN_TEXT_LENGTH = 60;  // Don't scan short snippets (emails, names, URLs)
const MAX_TEXT_LENGTH = 50000; // Don't hog CPU on giant pastes

let pollInterval = null;
let lastClipboardText = '';
let onDetect = null;
let lastNotifiedHash = '';

function startClipboardWatchdog(opts = {}) {
  onDetect = opts.onDetect || (() => {});
  lastClipboardText = clipboard.readText() || '';

  stopClipboardWatchdog();
  pollInterval = setInterval(checkClipboard, POLL_MS);
}

function stopClipboardWatchdog() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function checkClipboard() {
  const text = clipboard.readText();
  if (!text || text === lastClipboardText) return;
  lastClipboardText = text;

  if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) return;

  // Check ignore list
  const ignoreList = settings.get('watchdog.ignoreList', []);
  if (ignoreList.some(pattern => text.includes(pattern))) return;

  // Threshold from settings (high / medium / low)
  const threshold = settings.get('watchdog.threshold', 'medium');
  const slopFound = hasSlop(text, threshold);
  if (!slopFound) return;

  const scan = scanText(text);

  // Don't re-notify for the same clip (hash-based dedup)
  const hash = simpleHash(text);
  if (hash === lastNotifiedHash) return;
  lastNotifiedHash = hash;

  onDetect({ text, result: scan });
  fireNotification(text, scan);
}

function fireNotification(text, scan) {
  if (!Notification.isSupported()) return;

  const autoCleanMode = settings.get('watchdog.autoClean', false);

  if (autoCleanMode) {
    // Silent auto-clean — just swap clipboard contents
    const cleaned = localRewrite(text);
    clipboard.writeText(cleaned.text);
    new Notification({
      title: 'Slop Hog cleaned clipboard',
      body: `${cleaned.changeCount} changes · score ${scan.score} → ${scanText(cleaned.text).score}`,
      silent: true,
    }).show();
    return;
  }

  // Interactive mode — user clicks to clean
  const notif = new Notification({
    title: 'Slop Hog snorted',
    body: `Found ${scan.issues.length} issue${scan.issues.length === 1 ? '' : 's'} in clipboard. Click to clean.`,
    silent: false,
  });

  notif.on('click', () => {
    const cleaned = localRewrite(text);
    clipboard.writeText(cleaned.text);
    lastClipboardText = cleaned.text;
    new Notification({
      title: 'Clipboard cleaned',
      body: `${cleaned.changeCount} changes applied`,
      silent: true,
    }).show();
  });

  notif.show();
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length && i < 200; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

module.exports = { startClipboardWatchdog, stopClipboardWatchdog };
