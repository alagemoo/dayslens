# DayLens 👁

> Know where your day actually goes.

DayLens is a lightweight desktop app that silently tracks which applications you use throughout the day, how long you spend in each one, and turns that data into clear productivity insights — all stored privately on your own computer.

---

## Quick Start (Windows)

1. Open **Command Prompt** (press `Win + R`, type `cmd`, press Enter)
2. Navigate to this folder:
   ```
   cd path\to\daylens
   ```
3. Run the setup script (only needed once):
   ```
   setup.bat
   ```
4. Launch the app:
   ```
   npm start
   ```

## Quick Start (macOS)

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

## What it does

- **Tracks automatically** — records every app you use, every 5 seconds, silently in the background
- **Browser-aware** — detects Chrome, Firefox, Edge etc. (install the companion extension for per-tab tracking)
- **Dashboard** — beautiful UI showing today's activity, weekly trends, and productivity score
- **100% local** — all data lives in a SQLite database on your machine, never uploaded anywhere

---

## Data Location

Your activity database is stored at:
- **Windows:** `C:\Users\<you>\AppData\Roaming\daylens\daylens.db`
- **macOS:** `~/Library/Application Support/daylens/daylens.db`

---

## Permissions (Windows)

On Windows, DayLens uses standard Win32 APIs to detect the foreground window — no special permissions required.

On macOS, you'll be prompted to grant **Accessibility** access in System Preferences → Privacy & Security → Accessibility. This is required to read the active app name.

---

## MVP Roadmap

- [x] App tracking + SQLite storage
- [x] Dashboard: Today view, Weekly view, All Apps
- [x] Category detection (automatic)
- [x] Productivity score
- [x] Timeline visualization
- [ ] Browser extension (per-tab tracking)
- [ ] Goal setting
- [ ] AI weekly insight reports
- [ ] System tray with quick stats
- [ ] Auto-start on login
# dayslens
