# DayLens 👁

> Know where your day actually goes.

DayLens is a silent, local-first productivity tracker for Windows. It automatically records every app and website you use, categorizes your time intelligently, and delivers clear daily and weekly reports — no cloud, no subscription, no manual logging.

**Author:** Gideon Aniechi
**Organization:** Valion Technologies Limited
**Version:** 1.2.3
**License:** MIT — Copyright © 2026 Valion Technologies Limited

---

## Features

### 🔍 Automatic Tracking
- Records every app you use, every 6 seconds, completely silently
- Detects idle time, screen lock, sleep, and battery death — stops counting all of them
- **OS-level idle detection** — uses Windows `GetLastInputInfo` to detect when you haven't touched the keyboard or mouse for 5 minutes, even if the screen is on and a browser tab is active. Solves the overnight-charging problem where leaving a laptop plugged in with the screen on would record false activity
- Robust crash recovery: heartbeat written every 60 seconds so phantom data is cleaned on next launch
- **Single instance enforcement** — opening DayLens twice focuses the existing window instead of launching a duplicate

### 🌐 Browser Extension (Per-Tab Tracking)
- Companion extension for Chrome, Brave, and Edge
- Tracks exactly which website and tab you are on — not just "browser is open"
- SPA-aware: catches navigation on GitHub, Notion, React apps, and any history.pushState site
- Reconnects automatically after browser restart or service worker kill
- **Live connection status** — persistent indicator in the sidebar shows whether the extension is connected (green), disconnected (orange), or stale (yellow)

### 🗂 Smart Categorization
- 9 categories auto-assigned: **Deep Work, Learning, Communication, Documents, Browsing, Entertainment, Social Media, System, Other**
- Context-aware rules: YouTube tutorials vs entertainment; Reddit programming subs vs general browsing; LinkedIn job searching vs social scrolling
- 50+ apps and 80+ domains recognized out of the box including Microsoft Office, Adobe suite, AI assistants, server panels, and development tools
- Automatic classification of unknown domains via meta description fetching
- **Right-click any app** to permanently set its category — saved with user override, never overwritten by auto-classification

### 📋 Day Summary & Time Log
- **Smart local inference engine** — generates professional task descriptions from raw activity data without any AI. Recognizes patterns like "VS Code + .dart file → Software development — Flutter/Dart" or "YouTube + Healing Streams → Personal — religious broadcast"
- **Optional AI enhancement** — connect Puter.js (free, no key), Google Gemini, or OpenAI to upgrade task descriptions and add a narrative day analysis
- **Time log table** — Start, End, Task Description, Category, Duration — formatted for company timesheet submission
- **Copy to clipboard** — one click copies the full time log as formatted text for pasting into emails, timesheets, or reports
- **AI provider is configurable in Settings** — choose your provider, enter your API key if needed, or use no AI at all

### 📊 Dashboard Views
- **Today** — live focus score, time by category (donut chart), top apps, full-day timeline, current activity tracker
- **Weekly** — 7-day bar chart, week total, best day, productive time trend, weekly score ring
- **All Apps** — complete ranked list of everything tracked today
- **Day Log** — hour-by-hour breakdown with drill-down per app and exact visit timestamps

### 📄 PDF Export
- One-click export of daily or weekly report
- Includes: stats summary, category breakdown, top apps table, hourly activity chart, and insights
- Available from any view — Today, Day Log, or Weekly

### 🔔 Daily Summary Notification
- Desktop notification at 5:00 PM every day with focus score and top apps
- System tray: right-click to send summary on demand
- Preview any time from Settings

### 🎵 Background Audio Tracking
- Detects webinars, tutorials, and meetings playing in background browser tabs
- Logged separately with a visual indicator — doesn't inflate the active tab's time
- Covers Zoom, Google Meet, Teams, YouTube, Udemy, Coursera, and more

### 🚀 Launch at Login
- One toggle in Settings to start DayLens automatically on Windows login
- Uses Electron's native login item settings — no third-party dependencies

### 🔒 Security & Privacy
- **100% local** — all data in a local SQLite database, no cloud, no telemetry
- **API keys never leave the main process** — if you configure Gemini or OpenAI, the key is stored in the local database and API calls are made from the Electron main process. The renderer never sees the raw key
- **WebSocket hardened** — the extension communicates only on `127.0.0.1:43821`. Connections are validated by origin (must be a browser extension), remote address (must be localhost), and message type (whitelist of 9 valid event types). Input is sanitized and rate-limited to 15 messages/second
- **No command injection** — browser launch commands use a strict whitelist map
- **Extension permissions minimal** — only `tabs`, `activeTab`, `storage`, `alarms`, `windows`, and WebSocket access to localhost. No `<all_urls>`
- **PDF export sandboxed** — the hidden window used for PDF rendering runs with `sandbox: true`
- **PowerShell scripts stored safely** — written to the app's userData directory, not the system temp folder

---

## Installation

### Option A — Installer (recommended)

1. Run **`DayLens-Setup-1.2.3.exe`**
2. Follow the installer — choose your install directory
3. A desktop shortcut and Start Menu entry are created automatically
4. DayLens launches after install

### Option B — Portable

Run **`DayLens-Portable-1.2.3.exe`** directly — no installation needed. Data is stored in `AppData\Roaming\daylens` regardless of where the exe lives.

### Option C — From Source

```bash
git clone https://github.com/alagemoo/dayslens
cd dayslens
npm install
npm start
```

To build the executable:
```bash
npm run build
```

---

## Browser Extension Setup

1. Launch DayLens and go to **Settings & Extensions**
2. Click **Open Extension Folder**
3. In your browser go to `chrome://extensions` (or `brave://extensions`)
4. Enable **Developer Mode** (top right toggle)
5. Click **Load unpacked** and select the extension folder
6. The sidebar badge turns green with "Extension: connected" when active

> If upgrading from v1.1.0, remove the old extension first and reload it — v1.2.3 has updated manifest permissions.

---

## AI Provider Setup (Optional)

DayLens works fully offline with smart local inference. For enhanced AI-powered task descriptions and day narratives, configure a provider in **Settings → AI for Day Summary**:

| Provider | API Key Required | Cost | Notes |
|---|---|---|---|
| **None** (default) | No | Free | Smart local pattern matching — works offline |
| **Puter.js** | No | Free | GPT-4o-mini via Puter, loads on demand |
| **Google Gemini** | Yes | Free tier available | Gemini 2.0 Flash |
| **OpenAI** | Yes | Paid | GPT-4o-mini or equivalent |

API keys are stored locally in the SQLite database and API calls are made from the main process — keys never enter the renderer.

---

## Using the Day Summary

1. Navigate to **Day Summary** in the sidebar
2. A time log table appears immediately with smart local task descriptions
3. If an AI provider is configured, descriptions are enhanced in-place after a few seconds
4. Click **📋 Copy** to copy the entire time log as formatted text
5. Use **← →** arrows to view previous days

The copied format is ready for company timesheets:

```
TIME LOG
──────────────────────────────────────────────────────────────────────
Start      End        Duration   Task / Activity
──────────────────────────────────────────────────────────────────────
09:15 AM   10:45 AM   1h 30m     Software development — Flutter/Dart
10:45 AM   11:10 AM   25m        AI-assisted research & development
11:10 AM   12:30 PM   1h 20m     Code repository & version control
12:30 PM   01:00 PM   30m        Personal break — music
01:00 PM   03:15 PM   2h 15m     Technical learning — Node.js crash course
──────────────────────────────────────────────────────────────────────
                      5h 40m     TOTAL
```

---

## Data Location

```
Windows:   C:\Users\<you>\AppData\Roaming\daylens\daylens.db
```

The database is a standard SQLite file. You can inspect it with any SQLite browser.

---

## Roadmap

### Completed
- [x] Automatic app tracking + SQLite storage
- [x] Dashboard: Today, Weekly, All Apps, Day Log
- [x] Smart categorization (50+ apps, 80+ domains, meta-fetch for unknowns)
- [x] Manual category override with permanent memory
- [x] Weighted focus score + productivity scoring
- [x] Day timeline visualization
- [x] Browser extension — per-tab tracking with SPA support
- [x] PDF export with insights
- [x] Daily summary notification (5 PM)
- [x] Background audio tracking (webinars, meetings, tutorials)
- [x] Crash / battery-death recovery (paired heartbeat system)
- [x] OS-level idle detection (keyboard/mouse inactivity)
- [x] Real app icons + favicon system
- [x] Onboarding flow for new users
- [x] Launch at login
- [x] Single instance enforcement
- [x] Live extension connection indicator
- [x] AI-powered Day Summary with time log export
- [x] Configurable AI providers (Puter.js / Gemini / OpenAI / None)
- [x] Security hardening (API key isolation, WebSocket validation, input sanitization)

### Coming Next
- [ ] Goals & daily time limits per category
- [ ] Warnings when approaching time budgets
- [ ] Historical trends beyond 7 days
- [ ] Mac support

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 29 |
| Database | sql.js (SQLite compiled to WebAssembly) |
| Window detection | PowerShell + Win32 API (GetForegroundWindow, GetLastInputInfo) |
| Browser tracking | Chrome Extension Manifest V3 + local WebSocket |
| AI (optional) | Puter.js / Gemini REST API / OpenAI API |
| Typography | Inter, JetBrains Mono (Google Fonts) |
| Build | electron-builder (NSIS installer + portable) |

---

## License

MIT License

Copyright © 2026 Valion Technologies Limited

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

*Built by Gideon Aniechi — [Valion Technologies Limited](https://valiontech.com)*



![Downloads](https://img.shields.io/github/downloads/alagemoo/dayslens/total?label=Downloads&color=blue)
