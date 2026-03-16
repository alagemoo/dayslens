# Building DayLens as a Windows Installer

## Prerequisites
- Node.js 18+ installed
- npm 9+

## Steps

### 1. Install dependencies
```
npm install
```

### 2. Build the installer
```
npm run build
```

This produces two files in the `dist/` folder:
- `DayLens-Setup-1.0.0.exe` — Full NSIS installer (recommended)
  - Custom install directory
  - Start Menu shortcut
  - Desktop shortcut
  - Auto-starts with Windows (can disable in Task Manager > Startup)
  - Proper Add/Remove Programs entry
  
- `DayLens-Portable-1.0.0.exe` — Portable version, no install needed
  - Just double-click and run
  - Stores data in the same folder

### 3. Quick test (no installer, just the app folder)
```
npm run build:dir
```
Produces `dist/win-unpacked/DayLens.exe` — run directly without installing.

## Notes
- Build requires ~500MB download of Electron binaries on first run
- The build takes 2-5 minutes
- Windows may show SmartScreen warning on first run (unsigned app) — click "More info" → "Run anyway"
- To dismiss SmartScreen permanently, the .exe would need code signing (~$200/yr certificate)
