# Prompt Sweeper Desktop

Desktop app version of Prompt Sweeper, with **The Slop Hog** bolted on as an ambient menu-bar companion.

> Prompt Sweeper finds the slop. The Slop Hog eats it.

## Status

Scaffold + core features built. Art assets and advanced features (email digest, PDF/DOCX batch support, Claude integration) are stubbed and ready to wire.

## What's Built

### Core engine (`src/engine/`)
- **rules.js** — ~100 detection rules across 4 severity tiers, ported from the Chrome extension.
- **scanner.js** — `scanText(text)` and `hasSlop(text, threshold)` pure functions.
- **rewriter.js** — Local rules-based auto-fix with ~60 replacement patterns. Claude endpoint is optional and stubbed.

### The Slop Hog (`src/tray/`, `src/watchdog/`)
- **tray.js** — Menu-bar mascot with 4 states: `idle` (sleeping), `alert` (ears perked), `eating` (chomping), `full` (belly).
- **clipboard.js** — Polls clipboard every 800ms, scans on change, fires notification when slop detected. One-click auto-clean.

### Main window (`src/windows/main.html`)
- Scan tab (paste + scan + auto-fix)
- Batch folder tab (wired to `features/batch.js`)
- URL scan tab (wired to `features/url-scan.js`)
- Site watchdog tab (placeholder)
- Settings tab (watchdog on/off, sensitivity, auto-clean mode)

### Features (`src/features/`)
- **settings-store.js** — Persistent settings via electron-store.
- **batch.js** — Folder processor for .md and .txt (DOCX/PDF support stubbed).
- **url-scan.js** — Fetches a URL, scans, generates diff-style .md report.
- **site-watchdog.js** — Watched sites with history + weekly digest generator.
- **team-rules.js** — Custom rule file import (JSON format with regex + optional replacement).

## Install

```bash
cd prompt-sweeper-app
npm install
```

## Run

```bash
npm start
```

Runs in the menu bar (no dock icon on Mac). Click the pig to open the main window. Right-click the pig for the full menu.

## Before shipping — TODO

**Required:**
- [ ] Add mascot art assets to `assets/mascot/`: `idle.png`, `alert.png`, `eating.png`, `full.png` (18x18 for tray). On Mac, also provide `idleTemplate.png` etc. for auto theme-adaptation.
- [ ] Add `assets/icons/app-icon.png` for the app icon (512x512 recommended).

**Nice to have:**
- [ ] DOCX batch support (add `mammoth` dep, wire into `features/batch.js`).
- [ ] PDF batch support (add `pdf-parse` dep).
- [ ] Claude rewrite endpoint (point `settings.rewriter.claudeEndpoint` at a deployed worker).
- [ ] Email digest sender for site watchdog (SMTP config in settings).
- [ ] Team rules UI (import / remove files from settings tab).
- [ ] Open folder picker dialog (replace prompt with `dialog.showOpenDialog`).

## File Layout

```
prompt-sweeper-app/
├── package.json
├── main.js                   # Electron main process
├── preload.js                # Context bridge
├── src/
│   ├── engine/
│   │   ├── rules.js          # Detection rules
│   │   ├── scanner.js        # scanText + hasSlop
│   │   └── rewriter.js       # Auto-fix engine
│   ├── tray/
│   │   └── tray.js           # Menu-bar mascot
│   ├── watchdog/
│   │   └── clipboard.js      # Clipboard poller
│   ├── features/
│   │   ├── settings-store.js
│   │   ├── batch.js          # Folder batch scan
│   │   ├── url-scan.js       # URL + MD generator
│   │   ├── site-watchdog.js  # Scheduled site scans
│   │   └── team-rules.js     # Custom rule imports
│   └── windows/
│       └── main.html         # Main window UI
└── assets/
    ├── icons/                # App icon
    └── mascot/               # Pig states (idle/alert/eating/full)
```

## Tech Stack

- **Electron** — Cross-platform desktop (Mac, Windows, Linux).
- **electron-store** — Persistent settings.
- No other runtime dependencies — engine is pure JS.

## Brand

- Name: **Prompt Sweeper** (desktop app)
- Mascot: **The Slop Hog**
- Tagline: "Prompt Sweeper finds the slop. The Slop Hog eats it."
- Colors: navy `#0B1F3A`, cyan `#00C4D9`, linen `#FAF7F0`
- Publisher: Russell SPC LLC
