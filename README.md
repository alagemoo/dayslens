# DayLens 👁

> Know where your day actually goes.

DayLens is a lightweight desktop activity tracker that silently records every app and website you use, then turns that data into clear productivity insights — all stored privately on your own machine, no cloud, no subscription.

---

## Features

### 🔍 Automatic Tracking
- Records every app you use, every 6 seconds, completely silently
- Detects when you're idle, when the screen locks, or when the laptop sleeps — and stops counting
- Survives battery death and crashes without creating phantom data
- Smart detection of Windows system processes (never logs lock screen or idle time as activity)

### 🌐 Browser Extension (Per-Tab Tracking)
- Companion extension for Chrome, Brave, and Edge
- Tracks exactly which websites and tabs you're on, not just "browser is open"
- SPA-aware — catches navigation on GitHub, Notion, and other single-page apps
- Reconnects automatically if the browser restarts

### 🗂 Smart Categorization
- Automatically categorizes apps into: **Deep Work, Learning, Communication, Documents, Browsing, Entertainment, Social Media, System, Other**
- Context-aware rules: YouTube music vs YouTube tutorials get different categories; Reddit programming vs Reddit entertainment differ too
- Recognizes 50+ apps out of the box including Microsoft Office, Adobe suite, Zoom, Slack, VS Code, and more
- **Right-click any app to manually set its category** — saved permanently, never overwritten by auto-detection

### 📊 Dashboard Views
- **Today** — live productivity score, time by category (donut chart), top apps, and a full-day timeline
- **Weekly** — 7-day bar chart, week total, best day, and focus trend
- **All Apps** — complete list of everything tracked, sorted by time
- **Day Log** — hour-by-hour breakdown of your entire day with drill-down per app

### 📄 PDF Export
- Export any day or week as a polished PDF report
- Includes: stats summary, category breakdown, top apps, hourly chart, and AI-generated insights about your day
- Dark-themed, print-ready

### 🔔 Daily Summary Notification
- Desktop notification at 5:00 PM every day with your productivity score and top apps
- Trigger a preview any time from the app

### 🔒 100% Private
- All data is stored in a local SQLite database on your machine
- No accounts, no internet connection required, no telemetry

---

## Quick Start

### Windows

1. Open **Command Prompt** — press `Win + R`, type `cmd`, press Enter
2. Navigate to this folder:
   ```
   cd path\to\daylens
   ```
3. Run setup (only needed once):
   ```
   setup.bat
   ```
4. Launch the app:
   ```
   npm start
   ```

### macOS

1. Open **Terminal**
2. Navigate to this folder:
   ```
   cd /path/to/daylens
   ```
3. Run setup (only needed once):
   ```
   chmod +x setup.sh && ./setup.sh
   ```
4. Launch:
   ```
   npm start
   ```

---

## Browser Extension Setup

For per-tab browser tracking (recommended):

1. Launch DayLens and go to **Settings & Extensions**
2. Click **Open Extension Folder**
3. In your browser go to `chrome://extensions` (or `brave://extensions`)
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the extension folder
6. The extension will connect automatically — you'll see "Connected ✓" in Settings

> **Note:** If you previously installed an older version of the extension, remove it and reload it fresh to pick up the latest permissions.

---

## Using the Day Log

The Day Log shows your full day hour by hour. Each hour block lists every app used, with visit counts and durations.

- **Click** an app row to expand individual visits with timestamps
- **Right-click** any app to change its category — saved permanently
- **Export CSV** for spreadsheet analysis
- **Export PDF** for a shareable daily report
- Use the **← →** arrows to navigate to previous days

---

## Data Location

Your activity database lives at:
- **Windows:** `C:\Users\<you>\AppData\Roaming\daylens\daylens.db`
- **macOS:** `~/Library/Application Support/daylens/daylens.db`

---

## Permissions

**Windows:** Uses standard Win32 APIs to detect the foreground window — no special permissions required.

**macOS:** You'll be prompted to grant **Accessibility** access under System Preferences → Privacy & Security → Accessibility. This is required to read the active app name.

---

## Roadmap

- [x] App tracking + SQLite storage
- [x] Dashboard: Today, Weekly, All Apps, Day Log views
- [x] Smart automatic categorization (50+ apps)
- [x] Manual category override with permanent memory
- [x] Productivity score + Focus Score
- [x] Day timeline visualization
- [x] Browser extension — per-tab tracking
- [x] PDF export with AI-generated insights
- [x] Daily summary notification
- [x] Background audio tracking (webinars, music)
- [x] Crash / battery-death recovery — no phantom data
- [x] Idle / lock screen detection
- [ ] Goals & daily time limits per category
- [ ] App icons / favicons
- [ ] Historical trends beyond 7 days
- [ ] Auto-start on login

---

## Tech Stack

- **Electron** — cross-platform desktop shell
- **sql.js** — SQLite compiled to WebAssembly, runs in-process
- **PowerShell** (Windows) / **osascript** (macOS) — active window detection
- **WebSocket** — local communication between app and browser extension
- **Chromium extension APIs** — tab/URL tracking in the browser

---

## License

MIT
