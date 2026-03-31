# DayLens v1.2.3 — Release Notes

## Day Summary & Time Log
- New **Day Summary** page generates a professional timesheet from your activity data
- Smart local inference engine translates raw app usage into manager-ready task descriptions — no AI required
- Intelligent grouping: scattered blocks of the same work merge into single rows (e.g. three email checks across the morning become one "Communication" entry)
- Meetings, messaging, coding, and design stay properly separated
- 10-minute minimum filter keeps the log clean; minor activities roll into one "Other" row so totals always reconcile
- **Copy to clipboard** in timesheet format — paste directly into your company time log
- Optional AI enhancement via **Puter.js** (free, no key), **Google Gemini**, or **OpenAI** — configurable in Settings

## Overnight Idle Fix
- OS-level idle detection via Windows `GetLastInputInfo` — if no keyboard/mouse input for 5 minutes, tracking stops regardless of what's on screen
- Eliminates false activity from leaving a laptop charging overnight with the browser open

## Security Hardening
- API keys isolated to main process — never exposed to renderer
- WebSocket origin and localhost validation, input sanitization, rate limiting (15 msg/sec)
- Command injection prevention, PDF export sandboxed, extension `<all_urls>` permission removed
- Database save failures logged with user notification after 5 consecutive failures

## Other
- **Live extension status** indicator in sidebar (green/orange/yellow)
- **Single instance** enforcement — second launch focuses existing window
- **Auto-start at login** enabled by default, starts hidden in tray, user can disable in Settings
- Icon rebuilt with all Windows sizes (16–256px), `signAndEditExecutable` enabled for proper .exe embedding
- Extension version synced to 1.2.3 — **reload the extension after updating**

---

**Full changelog, upgrade notes, and security details:** see [README.md](README.md)

*Built by Gideon Aniechi — [Valion Technologies Limited](https://valiontech.com)*
