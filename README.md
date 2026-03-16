# DayLens 👁

> Know where your day actually goes.

DayLens is a silent, local-first productivity tracker for Windows. It automatically records every app and website you use, categorizes your time intelligently, and delivers clear daily and weekly reports — no cloud, no subscription, no manual logging.

**Author:** Gideon Aniechi  
**Organization:** Valion Technologies Limited  
**Version:** 1.1.0  
**License:** MIT — Copyright © 2026 Valion Technologies Limited

---

## What's New in v1.1.0

- **Real app icons & favicons** — every app now shows its actual icon. Browser domains fetch live favicons; desktop apps get a consistent colour-coded letter tile as fallback.
- **Onboarding flow** — first-time users are guided through the app with a 4-slide walkthrough covering setup, extension install, and auto-start.
- **Launch at login** — toggle in Settings to start DayLens automatically on Windows login.
- **Smarter categorization** — IP addresses and server admin panels correctly route to Deep Work. Any unrecognized domain now defaults to Browsing instead of Other. Extended patterns for Nigerian news sites, hosting panels, calculators, design tools, and project management apps.
- **Permanent crash recovery** — a paired heartbeat system (`last_alive` + `last_alive_check`) now reliably detects battery death, force-quit, and unexpected shutdowns. Phantom rows from Chrome service worker reconnects during downtime are collapsed to zero on next launch. Previous versions could misread the heartbeat on existing databases; v1.1.0 self-heals on first run.
- **Hour bucketing fix** — open browser sessions in the Day Log no longer bleed their full remaining duration into a single hour block. Each hour now shows only the actual time spent within that window.
- **Inter + JetBrains Mono typography** — upgraded from system fonts. Time values use monospace for clean alignment.
- **Polished UI** — deeper dark theme, stat card ambient glow, gradient accent on current activity banner, logo blink animation, refined hover states throughout.

---

## Features

### 🔍 Automatic Tracking
- Records every app you use, every 6 seconds, completely silently
- Detects idle time, screen lock, sleep, and battery death — stops counting all of them
- Robust crash recovery: heartbeat written every 60 seconds so phantom data is cleaned on next launch
- Smart Windows system process detection — lock screen and idle time never logged as activity

### 🌐 Browser Extension (Per-Tab Tracking)
- Companion extension for Chrome, Brave, and Edge
- Tracks exactly which website and tab you are on — not just "browser is open"
- SPA-aware: catches navigation on GitHub, Notion, React apps, and any history.pushState site
- Reconnects automatically after browser restart or service worker kill

### 🗂 Smart Categorization
- 9 categories auto-assigned: **Deep Work, Learning, Communication, Documents, Browsing, Entertainment, Social Media, System, Other**
- Context-aware rules: YouTube tutorials vs entertainment; Reddit programming vs general browsing
- 50+ apps recognized out of the box including Microsoft Office, Adobe suite, Zoom, Slack, VS Code
- IP addresses and hosting control panels (cPanel, vpspanel, Plesk) → Deep Work
- Any unrecognized domain → Browsing (not Other)
- **Right-click any app** to permanently set its category — saved with user override, never overwritten

### 📊 Dashboard Views
- **Today** — live focus score, time by category (donut chart), top apps, full-day timeline
- **Weekly** — 7-day bar chart, week total, best day, productive time trend
- **All Apps** — complete ranked list of everything tracked
- **Day Log** — hour-by-hour breakdown with drill-down per app and exact visit timestamps

### 🎨 App Icons
- Real favicons for browser domains via Google's favicon service
- Colour-coded letter tiles for desktop apps — consistent colour per app, graceful offline fallback
- 40+ known desktop apps mapped to their correct favicon domain

### 📄 PDF Export
- One-click export of daily or weekly report
- Includes: stats summary, category breakdown, top apps table, hourly activity chart, and 4 AI-written insights
- Available from any view — Today, Day Log, or Weekly

### 🔔 Daily Summary Notification
- Desktop notification at 5:00 PM every day with focus score and top apps
- Preview any time from the app via Settings

### 🎵 Background Audio Tracking
- Detects webinars, tutorials, and meetings playing in background browser tabs
- Logged separately with a visual indicator — doesn't inflate the active tab's time

### 🚀 Launch at Login
- One toggle in Settings → System to start DayLens automatically on Windows login
- Uses Electron's native `app.setLoginItemSettings()` — no third-party dependencies

### 🔒 100% Private
- All data in a local SQLite database — `AppData\Roaming\daylens\daylens.db`
- No accounts, no telemetry, no internet connection required
- Browser extension communicates only with the local app on `127.0.0.1` — never external servers

---

## Installation

### Option A — Installer (recommended)

1. Run **`DayLens Setup 1.1.0.exe`**
2. Follow the installer — choose your install directory
3. A desktop shortcut and Start Menu entry are created automatically
4. DayLens launches after install

### Option B — Portable

Run **`DayLens-Portable-1.1.0.exe`** directly — no installation needed. Data is stored in `AppData\Roaming\daylens` regardless of where the exe lives.

### Option C — From Source

```bash
git clone https://github.com/alagemoo/dayslens
cd dayslens
npm install
npm start
```

To build the executable yourself:
```bash
npm run build
```
> Run as Administrator to allow 7-Zip to create symbolic links during the build.

---

## Browser Extension Setup

1. Launch DayLens and go to **Settings & Extensions**
2. Click **Open Extension Folder**
3. In your browser go to `chrome://extensions` (or `brave://extensions`)
4. Enable **Developer Mode** (top right toggle)
5. Click **Load unpacked** and select the extension folder
6. Status shows "Connected ✓" in Settings when active

> If upgrading from a previous version, remove the old extension first and reload it fresh — v1.1.0 requires updated permissions.

---

## Using the Day Log

- **Click** any app row to expand individual visits with exact timestamps
- **Right-click** any app to change its category — saved permanently across all history
- **Export CSV** for spreadsheet analysis
- **Export PDF** for a shareable daily report
- **← →** arrows navigate to previous days

---

## Data Location

```
Windows:   C:\Users\<you>\AppData\Roaming\daylens\daylens.db
```

---

## Roadmap

### Completed
- [x] App tracking + SQLite storage
- [x] Dashboard: Today, Weekly, All Apps, Day Log
- [x] Smart automatic categorization (50+ apps)
- [x] Manual category override with permanent memory
- [x] Focus Score + productivity scoring
- [x] Day timeline visualization
- [x] Browser extension — per-tab tracking
- [x] PDF export with AI-generated insights
- [x] Daily summary notification
- [x] Background audio tracking
- [x] Crash / battery-death recovery
- [x] Idle / lock screen detection
- [x] Real app icons + favicon system
- [x] Onboarding flow for new users
- [x] Launch at login

### Coming in v1.2
- [ ] Goals & daily time limits per category
- [ ] Warnings when approaching time budgets
- [ ] Historical trends beyond 7 days

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 29 |
| Database | sql.js (SQLite → WebAssembly) |
| Window detection | PowerShell + Win32 API |
| Browser tracking | Chrome Extension API + local WebSocket |
| Typography | Inter, JetBrains Mono (Google Fonts) |

---

## License

MIT License

Copyright © 2026 Valion Technologies Limited

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

*Built by Gideon Aniechi — Valion Technologies Limited*