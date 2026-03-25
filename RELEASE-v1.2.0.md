# DayLens v1.2.0 — Release Notes

**Release Date:** March 2026
**Author:** Gideon Aniechi — Valion Technologies Limited

---

## What's New

### 🛡 Security Hardening

This release includes a comprehensive security audit and fixes across the entire codebase:

- **API key isolation** — AI provider keys (Gemini, OpenAI) are stored in the local SQLite database and API calls are made exclusively from the Electron main process. The renderer process never receives, stores, or transmits the raw key. Previously, the renderer made direct `fetch()` calls with the key in memory.
- **WebSocket origin validation** — The local WebSocket server (`127.0.0.1:43821`) now rejects connections with empty or invalid origin headers. Only `chrome-extension://` and `moz-extension://` origins are accepted. Remote address is verified to be localhost.
- **Input sanitization & rate limiting** — Every WebSocket message is validated against a whitelist of 9 event types. String fields (`url`, `title`, `domain`) are truncated and stripped of control characters. A rate limit of 15 messages/second prevents flooding.
- **Command injection prevention** — The `open-browser-extensions` handler now uses a strict whitelist map instead of interpolating user input into shell commands.
- **PDF export sandboxed** — The hidden BrowserWindow used for PDF generation now runs with `sandbox: true`.
- **Extension permissions tightened** — Removed `<all_urls>` from `host_permissions`. The extension only requests access to `ws://127.0.0.1:43821/*`.
- **PowerShell scripts relocated** — Moved from system temp directory to the app's `userData` folder to prevent tampering by other processes.
- **Database save error handling** — Failures are now logged with a counter. After 5 consecutive failures, a desktop notification warns the user about potential data loss.

### 🧠 AI-Powered Day Summary

A new **Day Summary** page generates a professional time log from your activity data — the kind you can submit to your company.

- **Smart local inference engine** — works offline, no AI needed. Recognizes 50+ app/domain patterns and generates professional task descriptions:
  - `VS Code` + `.dart` file → "Software development — Flutter/Dart"
  - `YouTube` + "HEALING STREAMS" → "Personal — religious broadcast"
  - `claude.ai` → "AI-assisted research & development"
  - `pcisecuritystandards.org` → "PCI compliance research"
  - `GitHub` + "pull request" in title → "Code review — pull requests"
- **Optional AI enhancement** — configure a provider in Settings to get smarter descriptions and a narrative day analysis. Supported providers:
  - **Puter.js** — free, no API key, loads on demand
  - **Google Gemini** — free tier available, user provides key
  - **OpenAI** — user provides key
  - **None** — local inference only (default)
- **Time log table** with Start, End, Task, Category, Duration columns
- **Copy to clipboard** — one click copies the full log as formatted text ready for timesheets
- **AI enhances in-place** — the table renders instantly with local descriptions, then AI upgrades each row live as the response arrives

### 🔧 Overnight Idle Bug Fix

**The root cause:** When a laptop was left charging overnight with the screen on and a browser tab open, the extension kept sending heartbeats every ~30 seconds. The app's 90-second timeout kept resetting, recording 8+ hours of fake activity.

**The fix:** DayLens now calls Windows `GetLastInputInfo` (and macOS `ioreg` for future support) every 6 seconds to check the actual last keyboard/mouse input time. If no input for 5 minutes, all activities are ended at the moment the user actually went idle — regardless of extension heartbeats. This completely eliminates false overnight tracking.

### 🔌 Live Extension Status Indicator

A persistent badge in the sidebar shows the browser extension connection status in real-time:
- 🟢 **Green** — "Extension: connected" (WebSocket active, receiving messages)
- 🟠 **Orange** — "Extension: not connected" (no WebSocket clients)
- 🟡 **Yellow** — "Extension: stale" (connected but no messages in 2 minutes)

Polls every 10 seconds. Previously, extension status was only checked when opening the Settings panel.

### 🚫 Single Instance Enforcement

Uses Electron's `app.requestSingleInstanceLock()`. If a second instance of DayLens is launched:
1. The existing window is focused (restored from minimize if needed)
2. The new instance exits immediately

This prevents duplicate tracking, duplicate WebSocket servers, and database corruption from concurrent writes.

---

## Upgrade Notes

### From v1.1.0

1. Extract the new zip and replace your `dayslens` folder contents
2. Run `npm install` if building from source (no new dependencies)
3. **Reload the browser extension** — the manifest permissions changed (`<all_urls>` removed). Go to your browser's extensions page, remove the old DayLens extension, then Load Unpacked with the new `assets/extension` folder
4. Run `npm start` to test

### Database Compatibility

v1.2.0 is fully backward-compatible with v1.1.0 databases. The `app_state` table is used for new settings (`ai_provider`, `ai_api_key`) — these are created on first access via `INSERT OR REPLACE`. No migration needed.

---

## Files Changed

| File | Changes |
|---|---|
| `package.json` | Version bump to 1.2.0 |
| `src/main.js` | OS idle detection, single instance lock, WebSocket hardening, input validation, rate limiting, AI settings IPC, `call-ai` IPC handler with `nodeFetch`, saveDB error handling, command injection fix, PDF sandbox, PS1 script relocation |
| `src/preload.js` | Added `getExtensionStatus`, `getDailySummaryData`, `getAISettings`, `setAISettings`, `callAI` |
| `src/renderer/index.html` | Extension status badge, Day Summary page with time log table, smart local inference engine, AI provider settings UI, copy-to-clipboard, modular AI dispatcher via IPC |
| `assets/extension/manifest.json` | Removed `<all_urls>` from host_permissions |
| `README.md` | Complete rewrite for v1.2.0 |

---

## Full Changelog

**New Features**
- OS-level user input idle detection (Windows GetLastInputInfo + macOS ioreg)
- Day Summary page with professional time log table
- Smart local task inference engine (50+ pattern rules)
- Configurable AI providers: Puter.js / Gemini / OpenAI / None
- Copy time log to clipboard in timesheet format
- Live extension connection indicator in sidebar
- Single instance enforcement
- AI settings panel in Settings

**Security Fixes**
- API keys isolated to main process (never cross IPC boundary)
- WebSocket origin validation hardened (reject empty origins)
- WebSocket remote address verification (localhost only)
- Message type whitelist validation
- Input sanitization (truncation + control char stripping)
- Rate limiting (15 msg/sec)
- Command injection prevention (whitelist map)
- PDF export BrowserWindow sandboxed
- Extension `<all_urls>` permission removed
- PowerShell scripts moved from temp to userData
- Database save failure logging + user notification

**Bug Fixes**
- Fixed overnight charging false activity recording
- Fixed browser extension heartbeats keeping sessions alive indefinitely

---

*DayLens is built by Gideon Aniechi — [Valion Technologies Limited](https://valiontech.com)*
