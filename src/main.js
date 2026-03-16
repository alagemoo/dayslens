const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');

const initSqlJs = require('sql.js');

let db = null;
const userDataPath = app.getPath('userData');
const DB_PATH     = path.join(userDataPath, 'daylens.db');


async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS activity (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      app_name     TEXT NOT NULL,
      window_title TEXT,
      url          TEXT,
      started_at   INTEGER NOT NULL,
      ended_at     INTEGER,
      is_background INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_activity_started ON activity(started_at);
    CREATE TABLE IF NOT EXISTS categories (
      app_name   TEXT PRIMARY KEY,
      category   TEXT NOT NULL DEFAULT 'Other',
      productive INTEGER NOT NULL DEFAULT 1
    );
  `);

  const seeds = [
    ['Code','Deep Work',1],['VSCode','Deep Work',1],['Visual Studio Code','Deep Work',1],
    ['Sublime Text','Deep Work',1],['WebStorm','Deep Work',1],['Figma','Deep Work',1],
    ['Adobe Photoshop','Deep Work',1],['Slack','Communication',1],
    ['Microsoft Teams','Communication',1],['Zoom','Communication',1],
    ['Discord','Communication',0],['Outlook','Communication',1],
    ['Telegram','Communication',1],['Microsoft Word','Documents',1],
    ['Microsoft Excel','Documents',1],['Microsoft PowerPoint','Documents',1],
    ['Notion','Documents',1],['Obsidian','Documents',1],
    ['Spotify','Entertainment',0],['Steam','Entertainment',0],
    ['Twitter','Social Media',0],['Reddit','Social Media',0],
    ['Windows Explorer','System',1],['Task Manager','System',1],['Taskmgr','System',1],
    ['PowerShell','System',1],['Command Prompt','System',1],
    // Browser domains
    ['github.com','Deep Work',1],['stackoverflow.com','Deep Work',1],
    ['notion.so','Documents',1],['docs.google.com','Documents',1],
    ['figma.com','Deep Work',1],['linear.app','Deep Work',1],
    // AI Assistants — always Deep Work
    ['claude.ai','Deep Work',1],['anthropic.com','Deep Work',1],
    ['chatgpt.com','Deep Work',1],['chat.openai.com','Deep Work',1],
    ['openai.com','Deep Work',1],['gemini.google.com','Deep Work',1],
    ['perplexity.ai','Deep Work',1],['copilot.microsoft.com','Deep Work',1],
    ['cursor.sh','Deep Work',1],['v0.dev','Deep Work',1],
    ['replit.com','Deep Work',1],['huggingface.co','Deep Work',1],
    ['phind.com','Deep Work',1],['poe.com','Deep Work',1],
    // Entertainment
    ['youtube.com','Entertainment',0],['netflix.com','Entertainment',0],
    ['twitter.com','Social Media',0],['x.com','Social Media',0],
    ['reddit.com','Social Media',0],['facebook.com','Social Media',0],
    ['instagram.com','Social Media',0],['tiktok.com','Social Media',0],
    ['gmail.com','Communication',1],['outlook.live.com','Communication',1],
    ['slack.com','Communication',1],['meet.google.com','Communication',1],
    ['zoom.us','Communication',1],['linkedin.com','Social Media',0],
    ['google.com','Browsing',1],['wikipedia.org','Browsing',1],
    ['notebooklm.google.com','Learning',1],
    ['keep.google.com','Documents',1],
    ['calendar.google.com','Documents',1],
    // Noise / utility apps
    ['Snipping Tool','System',0],
    ['Internet Download Manager','Other',0],
    ['Internet Download Manager (IDM)','Other',0],
    ['Calculator','System',0],
    ['Cortana','System',0],
    ['Microsoft Store','Browsing',0],
    // Office process name variants (as returned by PowerShell/Windows)
    ['WINWORD','Documents',1],['EXCEL','Documents',1],['POWERPNT','Documents',1],
    ['ONENOTE','Documents',1],['MSACCESS','Documents',1],['OUTLOOK','Communication',1],
    ['MSPUB','Documents',1],['VISIO','Documents',1],
    ['winword','Documents',1],['excel','Documents',1],['powerpnt','Documents',1],
    // Adobe apps
    ['Adobe Acrobat','Documents',1],['Acrobat','Documents',1],
    ['Adobe Premiere Pro','Deep Work',1],['Adobe After Effects','Deep Work',1],
    ['Adobe Audition','Deep Work',1],['Adobe InDesign','Documents',1],
    // Common productivity apps
    ['Notepad','Documents',1],['Notepad++','Documents',1],
    ['LibreOffice Writer','Documents',1],['LibreOffice Calc','Documents',1],
    ['LibreOffice Impress','Documents',1],
  ];
  // Safe migrations for existing DBs
  try { db.run('ALTER TABLE activity ADD COLUMN is_background INTEGER NOT NULL DEFAULT 0'); } catch(e) {}
  // Add user_override column if not present (safe migration for existing DBs)
  try { db.run('ALTER TABLE categories ADD COLUMN user_override INTEGER NOT NULL DEFAULT 0'); } catch(e) {}

  // State table — stores a single row with the last known alive timestamp.
  // Used by startup cleanup to distinguish "app was running" vs "battery died/crashed".
  db.run(`CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  // NOTE: We intentionally do NOT write last_alive here.
  // The startup cleanup reads it first, THEN startTracking() writes the new value.
  // This preserves the last known alive time for the crash-detection logic below.


  for (const [a, c, p] of seeds) {
    // System seeds always update UNLESS the user has manually overridden this entry
    // This ensures corrections (like LinkedIn → Social Media) take effect on existing DBs
    db.run(
      'INSERT INTO categories (app_name, category, productive, user_override) VALUES (?,?,?,0) ' +
      'ON CONFLICT(app_name) DO UPDATE SET category=excluded.category, productive=excluded.productive ' +
      'WHERE user_override=0',
      [a, c, p]
    );
  }

  // ── Startup cleanup: close any stale open activities ──────────────────────
  // Strategy: use last_alive heartbeat to know exactly when the app last ran.
  //
  //   Case A: row started BEFORE last_alive and gap > 2min
  //           → app was alive when row was created, crashed/died after.
  //             Cap at started_at + 2min (tight — crash shouldn't count as work).
  //
  //   Case B: row started AFTER last_alive
  //           → app was already dead (battery out, force kill) when row was created.
  //             These are phantom SW reconnect rows. Collapse to zero, invisible.
  //
  //   Case C: last_alive is missing, zero, or suspiciously old (> 24h ago)
  //           → DB is corrupt / first run / previous broken version.
  //             Treat ALL unclosed rows as phantom — safest option.

  const CRASH_CAP_MS = 2 * 60 * 1000;   // 2 min cap for real-but-crashed rows
  const MAX_ALIVE_AGE = 24 * 60 * 60 * 1000; // last_alive older than 24h = suspect
  const _now = Date.now();

  // Read and validate last_alive
  // We write a paired 'last_alive_check' = last_alive + 1 every time we write last_alive.
  // If they don't match, the DB is from a broken previous version — treat as untrusted.
  let _lastAlive = 0;
  try {
    const _stateRows = db.exec(
      "SELECT key, value FROM app_state WHERE key IN ('last_alive','last_alive_check')"
    );
    if (_stateRows.length && _stateRows[0].values.length) {
      const _map = {};
      for (const [k, v] of _stateRows[0].values) _map[k] = parseInt(v, 10);
      const _ts    = _map['last_alive']       || 0;
      const _check = _map['last_alive_check'] || 0;
      const _pairOk = (_check === _ts + 1); // must match exactly
      // Sanity: real timestamp, not future, not older than 24h, pair matches
      if (_ts > 0 && _ts <= _now && (_now - _ts) < MAX_ALIVE_AGE && _pairOk) {
        _lastAlive = _ts;
      }
      // Any failure → _lastAlive stays 0 → all unclosed rows treated as phantom (safest)
    }
  } catch(e) {}

  // Case A: real rows from before last_alive — cap tightly at 2 minutes
  db.run(`
    UPDATE activity
    SET ended_at = MIN(started_at + ${CRASH_CAP_MS},
                       (((started_at / 86400000) + 1) * 86400000))
    WHERE ended_at IS NULL
      AND started_at <= ${_lastAlive}
      AND started_at < ${_now - CRASH_CAP_MS}
  `);

  // Case B + C: phantom rows — collapse to zero, filtered out by the >= 1s display filter
  db.run(`
    UPDATE activity
    SET ended_at = started_at
    WHERE ended_at IS NULL
      AND started_at > ${_lastAlive}
  `);

  // ── Re-categorize known mis-classified entries in existing DBs ──────────────
  // IP-address domains (server panels) should be Deep Work, not Other
  db.run(`
    UPDATE categories
    SET category='Deep Work', productive=1
    WHERE user_override=0
      AND category='Other'
      AND (
        app_name GLOB '[0-9]*.[0-9]*.[0-9]*.[0-9]*'
        OR app_name LIKE '%vpspanel%'
        OR app_name LIKE '%web-hosting%'
        OR app_name LIKE '%cpanel%'
        OR app_name LIKE '%plesk%'
        OR app_name LIKE '%webmin%'
      )
  `);

  // ── Purge spurious "Idle" rows created when screen was locked ─────────────
  // Previous versions of DayLens tracked Windows "System Idle Process" as an
  // activity called "Idle". These rows represent time the screen was OFF and
  // should not appear in the Day Log. We collapse them to zero duration so
  // they are filtered out by the >= 1000ms display filter.
  // This runs once on every startup — safe to run on old databases.
  db.run(`
    UPDATE activity
    SET ended_at = started_at
    WHERE LOWER(app_name) IN ('idle','system idle process','dwm','winlogon',
                               'logonui','lockapp','screensaver','unknown')
      AND (ended_at IS NULL OR ended_at - started_at > 60000)
  `);

  saveDB();
}

function saveDB() {
  if (!db) return;
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (e) {}
}

setInterval(saveDB, 30000);

// ── WebSocket server for browser extension ────────────────────────────────────
const WS_PORT = 43821;
let wsClients = new Set();
let wsServer = null;

function startWebSocketServer() {
  // Minimal WebSocket handshake + framing — no npm package needed
  wsServer = http.createServer();

  wsServer.on('upgrade', (req, socket) => {
    // Only allow from localhost
    const origin = req.headers['origin'] || '';
    if (!origin.startsWith('chrome-extension://') && origin !== '') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const crypto = require('crypto');
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    socket.isAlive = true;
    wsClients.add(socket);

    // Buffer for incomplete frames across TCP packets
    let _frameBuffer = Buffer.alloc(0);
    socket.on('data', buf => {
      _frameBuffer = Buffer.concat([_frameBuffer, buf]);
      const { messages, remaining } = decodeWsFrames(_frameBuffer);
      _frameBuffer = remaining;
      for (const msg of messages) {
        try { handleBrowserEvent(JSON.parse(msg)); } catch(e) {}
      }
    });

    socket.on('close', () => {
      wsClients.delete(socket);
      const _now = Date.now();
      if (currentBrowserActivity) {
        db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [_now, currentBrowserActivity.id]);
        currentBrowserActivity = null;
      }
      endAllBackgroundSessions(_now);
      browserWindowFocused = false;
    });
    socket.on('error', () => {
      socket.destroy();
      wsClients.delete(socket);
      if (currentBrowserActivity) {
        db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [Date.now(), currentBrowserActivity.id]);
        currentBrowserActivity = null;
      }
      browserWindowFocused = false;
    });
  });

  wsServer.listen(WS_PORT, '127.0.0.1', () => {
    console.log(`[DayLens] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
  });

  wsServer.on('error', e => {
    console.error('[DayLens] WebSocket server error:', e.message);
  });
}

// Decode ALL WebSocket frames from a buffer.
// Returns { messages: string[], remaining: Buffer }
// TCP can deliver multiple frames in one packet, or split a frame across packets.
function decodeWsFrames(buf) {
  const messages = [];
  let pos = 0;
  while (pos < buf.length) {
    if (buf.length - pos < 2) break; // need at least 2 header bytes
    const masked   = (buf[pos + 1] & 0x80) !== 0;
    let payloadLen =  buf[pos + 1] & 0x7f;
    let offset     = pos + 2;
    if (payloadLen === 126) {
      if (buf.length - pos < 4) break;
      payloadLen = buf.readUInt16BE(pos + 2);
      offset = pos + 4;
    } else if (payloadLen === 127) {
      if (buf.length - pos < 10) break;
      payloadLen = Number(buf.readBigUInt64BE(pos + 2));
      offset = pos + 10;
    }
    const frameEnd = offset + (masked ? 4 : 0) + payloadLen;
    if (frameEnd > buf.length) break; // incomplete frame — wait for next TCP packet
    let text;
    if (!masked) {
      text = buf.slice(offset, offset + payloadLen).toString('utf8');
    } else {
      const mask    = buf.slice(offset, offset + 4);
      const payload = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) payload[i] = buf[offset + 4 + i] ^ mask[i % 4];
      text = payload.toString('utf8');
    }
    messages.push(text);
    pos = frameEnd;
  }
  return { messages, remaining: buf.slice(pos) };
}

// ── Browser event handler ─────────────────────────────────────────────────────
let currentBrowserActivity = null;
let browserWindowFocused = true; // track if browser window has focus

// ── Background audio sessions ─────────────────────────────────────────────────
// Key = url, Value = { id, appName, url, title, startedAt, lastSeen }
// Tracks tabs that are audible in the background (webinars, tutorial videos)
// while the user is focused on another window/app.
const backgroundAudioSessions = new Map();

// Domains we consider worth tracking as background audio
const MEETING_DOMAINS = [
  'zoom.us','meet.google.com','teams.microsoft.com','webex.com',
  'gotomeeting.com','bluejeans.com','whereby.com','around.co',
  'discord.com','skype.com','meet.jit.si'
];
const LEARNING_VIDEO_DOMAINS = [
  'youtube.com','youtu.be','vimeo.com','loom.com',
  'udemy.com','coursera.org','khanacademy.org','linkedin.com/learning',
  'pluralsight.com','skillshare.com','egghead.io'
];

function isBackgroundTrackable(domain, title) {
  const d = (domain || '').toLowerCase();
  const t = (title  || '').toLowerCase();
  // Always track live meeting/webinar domains
  if (MEETING_DOMAINS.some(m => d.includes(m))) return true;
  // Track learning video domains
  if (LEARNING_VIDEO_DOMAINS.some(m => d.includes(m))) return true;
  return false;
}

function startBackgroundSession(url, domain, title, now) {
  if (backgroundAudioSessions.has(url)) return; // already tracking
  const appName = domain || url;
  db.run(
    'INSERT INTO activity (app_name, window_title, url, started_at, is_background) VALUES (?,?,?,?,1)',
    [appName, title || appName, url, now]
  );
  const rows = db.exec('SELECT last_insert_rowid() as id');
  const id = rows[0].values[0][0];
  backgroundAudioSessions.set(url, { id, appName, url, title, startedAt: now, lastSeen: now });
}

function endBackgroundSession(url, now) {
  const session = backgroundAudioSessions.get(url);
  if (!session) return;
  db.run('UPDATE activity SET ended_at=? WHERE id=?', [now, session.id]);
  backgroundAudioSessions.delete(url);
}

function endAllBackgroundSessions(now) {
  for (const [url] of backgroundAudioSessions) endBackgroundSession(url, now);
}

function handleBrowserEvent(data) {
  if (!db) return;
  const { type, url, title, domain } = data;
  const now = Date.now();

  // Track whether the browser window itself is focused
  if (type === 'window_focused')   { browserWindowFocused = true;  return; }
  if (type === 'window_blurred')   { browserWindowFocused = false;
    // End current browser activity — user left the browser
    if (currentBrowserActivity) {
      db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [now, currentBrowserActivity.id]);
      currentBrowserActivity = null;
    }
    // Background audio sessions CONTINUE — user left the browser but
    // the webinar/video is still playing. Don't end them on blur.
    return;
  }

  // Heartbeat — refresh idle timers for both active and background sessions
  if (type === 'heartbeat') {
    if (currentBrowserActivity) currentBrowserActivity.lastHeartbeat = now;
    // Update lastSeen for all background sessions so they don't time out
    for (const [, session] of backgroundAudioSessions) session.lastSeen = now;
    return;
  }

  // Background audio — a non-active tab is playing audio (webinar, tutorial, meeting)
  if (type === 'background_audio') {
    if (!url || !isBackgroundTrackable(domain, title)) return;
    const session = backgroundAudioSessions.get(url);
    if (session) {
      // Already tracking — update title if changed and refresh lastSeen
      session.lastSeen = now;
      if (title && title !== session.title) {
        db.run('UPDATE activity SET window_title=? WHERE id=?', [title, session.id]);
        session.title = title;
      }
    } else {
      startBackgroundSession(url, domain, title, now);
    }
    return;
  }

  // Background audio ended — tab muted, paused, closed, or became active
  if (type === 'background_audio_end') {
    endBackgroundSession(url, now);
    return;
  }

  if (type === 'tab_active' || type === 'tab_updated') {
    const appName = domain || (() => { try { return new URL(url).hostname.replace('www.',''); } catch(e){ return url; } })();

    // ── SAME tab keepalive: just update the title if changed, don't create new row ──
    if (currentBrowserActivity && currentBrowserActivity.url === url) {
      if (title && title !== currentBrowserActivity.title) {
        db.run(`UPDATE activity SET window_title=? WHERE id=?`, [title, currentBrowserActivity.id]);
        currentBrowserActivity.title = title;
        // Re-evaluate category on title change (e.g. YouTube video changed)
        currentBrowserActivity.appName = appName;
      }
      return; // same tab — no new row, no timer reset
    }

    // ── Different tab: end previous, start new ────────────────────────────────
    if (currentBrowserActivity) {
      // Cap based on last heartbeat time (not startedAt) to handle long sessions correctly
      const lastSeen = currentBrowserActivity.lastHeartbeat || currentBrowserActivity.startedAt;
      const prevEnd = Math.min(now, lastSeen + IDLE_MS);
      db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [prevEnd, currentBrowserActivity.id]);
      currentBrowserActivity = null;
    }

    if (!url || url.startsWith('chrome://') || url.startsWith('brave://') ||
        url.startsWith('chrome-extension://') || url === 'about:blank' || url === 'newtab') {
      return;
    }

    db.run(`INSERT INTO activity (app_name, window_title, url, started_at) VALUES (?,?,?,?)`,
      [appName, title || appName, url, now]);
    const rows = db.exec(`SELECT last_insert_rowid() as id`);
    currentBrowserActivity = { id: rows[0].values[0][0], appName, url, title, startedAt: now };
    // Trigger AI classification if this domain lands in Other
    const _cat = guessCategory(appName, title);
    if (_cat.category === 'Other') aiClassify(appName, title).catch(() => {});

  } else if (type === 'tab_hidden' || type === 'browser_hidden') {
    if (currentBrowserActivity) {
      db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [now, currentBrowserActivity.id]);
      currentBrowserActivity = null;
    }
  }
}

// ── Active window (Windows via PowerShell temp file) ──────────────────────────
function getActiveWindowWin32() {
  try {
    const tmpScript = path.join(app.getPath('temp'), 'daylens_win.ps1');
    if (!fs.existsSync(tmpScript)) {
      fs.writeFileSync(tmpScript, `
$h = (Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder t, int c); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);' -Name WinAPI -PassThru)
$hwnd = $h::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
$h::GetWindowText($hwnd, $sb, 256) | Out-Null
$pid2 = 0
$h::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
$name = if ($proc) { try { $proc.MainModule.FileVersionInfo.ProductName } catch { $proc.ProcessName } } else { 'Unknown' }
if (-not $name -or $name.Trim() -eq '') { $name = if ($proc) { $proc.ProcessName } else { 'Unknown' } }
Write-Output "$($name.Trim())|||$($sb.ToString().Trim())"
      `.trim());
    }
    const result = execSync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpScript}"`,
      { timeout: 3000, windowsHide: true }
    ).toString().trim();
    const parts = result.split('|||');
    if (parts.length < 2) return null;
    return { owner: { name: parts[0] || 'Unknown' }, title: parts[1] || '' };
  } catch (e) { return null; }
}

function getActiveWindowMac() {
  try {
    const result = execSync(
      `osascript -e 'tell application "System Events" to set f to first application process whose frontmost is true' -e 'set n to name of f' -e 'set t to ""' -e 'try' -e 'set t to title of front window of f' -e 'end try' -e 'return n & "|||" & t'`,
      { timeout: 3000 }
    ).toString().trim();
    const parts = result.split('|||');
    return { owner: { name: parts[0] || 'Unknown' }, title: parts[1] || '' };
  } catch (e) { return null; }
}

function getActiveWindow() {
  if (process.platform === 'win32') return getActiveWindowWin32();
  if (process.platform === 'darwin') return getActiveWindowMac();
  return null;
}

// ── Smart category engine ─────────────────────────────────────────────────────
//
// Title-aware: uses both the domain/app name AND the page title to make
// intelligent decisions. e.g. YouTube tutorial vs YouTube movie.
//
// Priority order:
//   1. User-saved override (from categories table)
//   2. Title-based smart rules (per domain)
//   3. Domain/app-level defaults
//   4. Generic keyword fallback

// Keywords that strongly signal learning / work regardless of site
const LEARNING_TITLE_KEYWORDS = [
  // Explicit educational intent
  'tutorial','course','lecture','lesson','workshop','how to','how-to',
  'learn','learning','bootcamp','masterclass','crash course','introduction to',
  'getting started','beginner','intermediate','advanced','explained','guide',
  'walkthrough','step by step','from scratch','for beginners','in depth',
  // Programming & tech
  'programming','coding','javascript','python','react','node','css','html',
  'typescript','rust','golang','java','swift','kotlin','c++','sql','api',
  'machine learning','deep learning','neural network','data science','algorithms',
  'system design','architecture','devops','docker','kubernetes','aws','azure','gcp',
  'cloud','cybersecurity','ethical hacking','linux','bash','git',
  // Academic subjects
  'math','mathematics','calculus','statistics','linear algebra','physics',
  'chemistry','biology','history','economics','philosophy','psychology',
  'finance','accounting','law','medicine',
  // Education platforms & channels (in titles)
  'mit opencourseware','stanford','harvard','coursera','udemy','freecodecamp',
  'cs50','khan academy','ted talk','ted-ed','lecture series','fireship',
  'traversy media','the primeagen','kevin powell','neetcode','tech with tim',
  '3blue1brown','computerphile',
  // Concept signals
  'documentary','explained by','science of','history of','theory of',
  'what is','why does','how does','understanding','deep dive',
  'full course','full tutorial','complete guide','complete course',
];

// Keywords that signal pure entertainment / distraction
const ENTERTAINMENT_TITLE_KEYWORDS = [
  // Movies & TV
  'movie','film','trailer','official trailer','season','episode','ep.',
  's01','s02','s03','s04','s05','e01','e02','e03','full movie','full film',
  // Music
  'music video','official video','official audio','lyrics','lyric video','official mv',
  // Vlogs & lifestyle
  'vlog','day in my life','with me','storytime','prank','challenge',
  'grwm','get ready with me','what i eat','morning routine','haul','unboxing',
  // Reactions & low-effort
  'reaction','reacts to','watch party','i watched','first time watching',
  // Gaming & streaming
  'live stream','streaming now','gaming','gameplay',"let's play",
  'playthrough','speedrun','highlights','gaming highlights',
  'compilation','funny moments','fails','best of','moments',
  // Memes & shorts
  'meme','memes','shorts','tiktok compilation','reddit compilation',
  // Entertainment shows
  'joe rogan','hot ones','interview with','celebrity interview',
];

// ── Auto-labelling (free, no API key) ────────────────────────────────────────
// For unknown domains: fetch the site's meta description/keywords via HTTP,
// then classify locally using keyword matching.
// For unknown desktop apps: expanded keyword heuristics.
// Results cached permanently in DB — each app/domain classified only once.

const AUTO_LABEL_QUEUE  = new Set();
const AUTO_LABEL_BUSY   = { v: false };

// ── Local keyword classifier ──────────────────────────────────────────────────
// Takes any text (meta description, app name, window title) and returns a category
function classifyFromText(text) {
  const t = (text || '').toLowerCase();

  const rules = [
    // Deep Work signals
    { cat: 'Deep Work', prod: 1, kw: [
      'code','coding','developer','development','programming','software','api',
      'database','devops','deploy','repository','github','git','terminal','cli',
      'ide','editor','debug','compiler','framework','library','sdk','saas',
      'design tool','figma','sketch','adobe','photoshop','illustrator','prototype',
      'wireframe','ux','ui design','dashboard','analytics','data analysis',
      'spreadsheet','accounting','invoice','crm','project management','task',
      'kanban','agile','scrum','documentation','technical','engineering','architect',
      'server','cloud','aws','azure','gcp','kubernetes','docker','devtool',
      'postman','jira','confluence','bitbucket','gitlab','vercel','netlify',
      'supabase','heroku','linear','asana','trello','clickup','monday',
      'github','paystack','flutterwave','stripe','paypal','fintech',
      'bank','finance','accounting','bookkeeping','quickbooks','xero','sage',
    ]},
    // Learning signals
    { cat: 'Learning', prod: 1, kw: [
      'learn','tutorial','course','lesson','lecture','education','teach',
      'training','bootcamp','certification','exam','quiz','study','university',
      'academic','science','mathematics','history','philosophy','biology',
      'chemistry','physics','psychology','economics','research','knowledge',
      'how to','guide','explained','understanding','introduction to','beginner',
      'advanced','masterclass','workshop','webinar','e-learning','mooc',
      'textbook','textbooks','scholarship','skills','self-improvement',
      'udemy','coursera','edx','pluralsight','skillshare','khanacademy',
      'duolingo','quizlet','anki','brilliant','codecademy','freecodecamp',
    ]},
    // Communication signals
    { cat: 'Communication', prod: 1, kw: [
      'email','inbox','message','chat','messaging','collaboration','meeting',
      'video call','conference','team','slack','workspace','discuss','thread',
      'notification','contact','calendar','schedule','appointment','call',
      'outlook','gmail','mail','zoom','teams','meet','telegram','whatsapp',
      'signal','discord','skype','webex','loom','calendly',
    ]},
    // Documents signals
    { cat: 'Documents', prod: 1, kw: [
      'document','word processor','spreadsheet','presentation','notes','note-taking',
      'writing','draft','report','proposal','template','pdf','file manager',
      'cloud storage','drive','dropbox','onedrive','backup','sync',
      'notion','obsidian','roam','evernote','bear','typora','onenote',
    ]},
    // Entertainment signals
    { cat: 'Entertainment', prod: 0, kw: [
      'movie','film','watch','stream','streaming','episode','season','series',
      'anime','cartoon','comedy','drama','action','thriller','horror',
      'music','song','playlist','album','artist','lyrics','concert',
      'game','gaming','play','esports','twitch','sport','football','basketball',
      'celebrity','entertainment','fun','funny','humor','meme','viral',
      'vlog','lifestyle','travel','food','recipe','cooking show',
      'netflix','hulu','disney','hbo','prime video','peacock','paramount',
      'spotify','apple music','soundcloud','deezer','tidal','pandora',
      'steam','epic games','origin','battle.net','roblox','minecraft',
    ]},
    // Social Media signals
    { cat: 'Social Media', prod: 0, kw: [
      'social network','social media','followers','following','likes','post',
      'share','feed','timeline','profile','connect','friend','influencer',
      'community','forum','discussion','comment','react','trending',
      'twitter','instagram','facebook','tiktok','snapchat','pinterest',
      'reddit','tumblr','mastodon','threads','x.com',
    ]},
    // News/Browsing signals
    { cat: 'Browsing', prod: 1, kw: [
      'news','article','magazine','blog','journalist','press','media',
      'breaking news','headline','opinion','editorial','weather','sports news',
      'business news','technology news','health news','politics',
      'bbc','cnn','techcrunch','medium','substack','wikipedia',
    ]},
    // System signals
    { cat: 'System', prod: 0, kw: [
      'system utility','antivirus','security','firewall','backup','cleaner',
      'optimizer','driver','update','installer','setup','uninstall','registry',
      'task manager','process','cpu','memory','storage','disk','monitor',
      'control panel','device manager','activity monitor','system preferences',
    ]},
  ];

  // Score each category by how many keywords match
  const scores = {};
  for (const rule of rules) {
    scores[rule.cat] = { score: 0, prod: rule.prod };
    for (const kw of rule.kw) {
      if (t.includes(kw)) scores[rule.cat].score += 1;
    }
  }

  // Pick highest score if it's meaningful
  const best = Object.entries(scores)
    .filter(([, v]) => v.score > 0)
    .sort((a, b) => b[1].score - a[1].score)[0];

  if (best && best[1].score >= 1) {
    return { category: best[0], productive: best[1].prod === 1 };
  }
  return null;
}

// ── Fetch meta description from a website ────────────────────────────────────
async function fetchSiteMeta(domain) {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const http  = require('http');
      const url = `https://${domain}`;
      const lib = url.startsWith('https') ? https : http;

      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DayLens/1.0)',
          'Accept': 'text/html',
        },
        timeout: 5000,
      }, (res) => {
        // Follow one redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchSiteMeta(res.headers.location.replace(/^https?:\/\/[^/]+/, '')));
          return;
        }
        let html = '';
        res.on('data', chunk => {
          html += chunk;
          if (html.length > 8000) req.destroy(); // only need the <head>
        });
        res.on('end', () => {
          // Extract meta description
          const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,300})["']/i)
                         || html.match(/<meta[^>]+content=["']([^"']{10,300})["'][^>]+name=["']description["']/i);
          const kwMatch   = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']{5,200})["']/i);
          const titleMatch= html.match(/<title[^>]*>([^<]{3,100})<\/title>/i);
          const ogDesc    = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,300})["']/i);

          const combined = [
            descMatch?.[1] || '',
            kwMatch?.[1]   || '',
            titleMatch?.[1]|| '',
            ogDesc?.[1]    || '',
          ].join(' ');

          resolve(combined.trim() || null);
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch(e) {
      resolve(null);
    }
  });
}

// ── Main auto-classify entry point ───────────────────────────────────────────
async function aiClassify(appName, windowTitle) {
  if (!appName) return null;
  const key = appName.toLowerCase().trim();
  if (AUTO_LABEL_QUEUE.has(key)) return null;
  AUTO_LABEL_QUEUE.add(key);

  // Check DB first — already classified?
  if (db) {
    const existing = db.exec(
      `SELECT category, productive FROM categories WHERE lower(app_name) = lower(?)`,
      [appName]
    );
    if (existing.length && existing[0].values.length) {
      AUTO_LABEL_QUEUE.delete(key);
      return null;
    }
  }

  try {
    let result = null;

    // Step 1: Try classifying from the app name + window title alone
    const nameText = `${appName} ${windowTitle || ''}`;
    result = classifyFromText(nameText);

    // Step 2: If it's a domain (contains a dot), fetch meta and classify from that
    const isDomain = appName.includes('.') && !appName.includes(' ') && !appName.includes('\\');
    if (!result && isDomain) {
      console.log(`[DayLens] Fetching meta for unknown domain: ${appName}`);
      const meta = await fetchSiteMeta(appName);
      if (meta) {
        result = classifyFromText(meta + ' ' + nameText);
        if (result) console.log(`[DayLens] Meta classify "${appName}" → ${result.category}`);
      }
    }

    // Step 3: If still unknown, default to Browsing for domains, Other for apps
    if (!result) {
      result = isDomain
        ? { category: 'Browsing', productive: 1 }
        : null; // leave desktop apps as Other if we can't figure them out
    }

    if (result && db) {
      db.run(
        'INSERT INTO categories (app_name, category, productive, user_override) VALUES (?,?,?,0) ' +
        'ON CONFLICT(app_name) DO UPDATE SET category=excluded.category, productive=excluded.productive WHERE user_override=0',
        [appName, result.category, result.productive ? 1 : 0]
      );
      saveDB();
      console.log(`[DayLens] Auto-labelled "${appName}" → ${result.category}`);
    }
    return result;
  } catch(e) {
    console.log('[DayLens] Auto-label error:', e.message);
    return null;
  } finally {
    AUTO_LABEL_QUEUE.delete(key);
  }
}

// Per-domain smart rules: returns { category, productive } or null
function smartDomainRule(domain, title) {
  const d = (domain || '').toLowerCase();
  const t = (title || '').toLowerCase();

  // ── YouTube ────────────────────────────────────────────────────────────────
  if (d.includes('youtube.com') || d === 'youtu.be') {
    // No title or just the homepage = neutral browsing
    if (!title || t === 'youtube') return { category: 'Browsing', productive: 1 };
    // Strong learning signal wins first
    if (LEARNING_TITLE_KEYWORDS.some(k => t.includes(k))) return { category: 'Learning', productive: 1 };
    // Strong entertainment signal
    if (ENTERTAINMENT_TITLE_KEYWORDS.some(k => t.includes(k))) return { category: 'Entertainment', productive: 0 };
    // YouTube Shorts are almost always entertainment
    if (t.includes('#shorts') || t.includes('shorts')) return { category: 'Entertainment', productive: 0 };
    // Has a video title but no clear signal → lean Entertainment (most YouTube is passive)
    return { category: 'Entertainment', productive: 0 };
  }

  // ── Reddit ─────────────────────────────────────────────────────────────────
  if (d.includes('reddit.com')) {
    // Subreddits that are work/learning oriented
    const workSubs = [
      'programming','webdev','learnprogramming','javascript','python','reactjs',
      'node','typescript','devops','machinelearning','datascience','netsec',
      'cscareerquestions','sysadmin','homelab','entrepreneur','startups',
      'productivity','personalfinance','investing','economics','science',
      'askscience','explainlikeimfive','todayilearned','futurology',
    ];
    if (workSubs.some(s => t.includes('/r/' + s) || t.includes('r/' + s))) return { category: 'Learning', productive: 1 };
    if (LEARNING_TITLE_KEYWORDS.some(k => t.includes(k))) return { category: 'Learning', productive: 1 };
    return { category: 'Social Media', productive: 0 };
  }

  // ── Twitter / X ────────────────────────────────────────────────────────────
  if (d.includes('twitter.com') || d.includes('x.com')) {
    return { category: 'Social Media', productive: 0 };
  }

  // ── GitHub ─────────────────────────────────────────────────────────────────
  if (d.includes('github.com')) {
    if (t.includes('issues') || t.includes('pull request') || t.includes('commits')) return { category: 'Deep Work', productive: 1 };
    if (t.includes('readme') || t.includes('wiki')) return { category: 'Deep Work', productive: 1 };
    return { category: 'Deep Work', productive: 1 };
  }

  // ── Google ─────────────────────────────────────────────────────────────────
  if (d === 'google.com' || d.includes('www.google.')) {
    if (t.includes('google docs') || t.includes('google sheets') || t.includes('google slides')) return { category: 'Documents', productive: 1 };
    if (LEARNING_TITLE_KEYWORDS.some(k => t.includes(k))) return { category: 'Learning', productive: 1 };
    return { category: 'Browsing', productive: 1 };
  }

  // ── Docs / Notion / Writing ────────────────────────────────────────────────
  if (d.includes('docs.google.com')) return { category: 'Documents', productive: 1 };
  if (d.includes('sheets.google.com') || d.includes('slides.google.com') ||
      d.includes('drive.google.com') || d.includes('calendar.google.com')) {
    return { category: 'Documents', productive: 1 };
  }
  if (d.includes('notebooklm.google.com')) return { category: 'Learning', productive: 1 };
  if (d.includes('notion.so')) return { category: 'Documents', productive: 1 };
  if (d.includes('obsidian.md') || d.includes('roamresearch.com') ||
      d.includes('logseq.com') || d.includes('capacities.io')) {
    return { category: 'Documents', productive: 1 };
  }

  // ── AI Assistants ──────────────────────────────────────────────────────────
  // These are always Deep Work — using AI tools is productive by definition
  if (
    d.includes('claude.ai') || d.includes('anthropic.com') ||
    d.includes('chatgpt.com') || d.includes('chat.openai.com') || d.includes('openai.com') ||
    d.includes('gemini.google.com') || d.includes('bard.google.com') ||
    d.includes('perplexity.ai') ||
    d.includes('copilot.microsoft.com') || d.includes('copilot.github.com') ||
    d.includes('cursor.sh') || d.includes('v0.dev') || d.includes('replit.com') ||
    d.includes('huggingface.co') || d.includes('mistral.ai') || d.includes('cohere.com') ||
    d.includes('phind.com') || d.includes('you.com') || d.includes('poe.com')
  ) return { category: 'Deep Work', productive: 1 };

  // ── Dev tools ─────────────────────────────────────────────────────────────
  if (d.includes('stackoverflow.com') || d.includes('stackexchange.com')) return { category: 'Deep Work', productive: 1 };
  if (d.includes('developer.mozilla.org') || d.includes('mdn') || d.includes('devdocs.io')) return { category: 'Deep Work', productive: 1 };
  if (d.includes('npmjs.com') || d.includes('pypi.org') || d.includes('crates.io')) return { category: 'Deep Work', productive: 1 };
  if (d.includes('vercel.com') || d.includes('netlify.com') || d.includes('render.com') || d.includes('railway.app')) return { category: 'Deep Work', productive: 1 };
  if (d.includes('linear.app') || d.includes('jira') || d.includes('trello.com') || d.includes('asana.com') || d.includes('clickup.com')) return { category: 'Deep Work', productive: 1 };
  if (d.includes('figma.com') || d.includes('dribbble.com') || d.includes('behance.net')) return { category: 'Deep Work', productive: 1 };

  // ── Server / hosting admin panels ─────────────────────────────────────────
  // IP addresses accessed in browser are almost always server admin/dev work
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(d)) return { category: 'Deep Work', productive: 1 };
  // Hosting control panels
  if (d.includes('cpanel') || d.includes('whm.') || d.includes('vpspanel') ||
      d.includes('web-hosting') || d.includes('plesk') || d.includes('directadmin') ||
      d.includes('webmin') || d.includes('panel.') || d.includes('.panel.')) {
    return { category: 'Deep Work', productive: 1 };
  }

  // ── Learning platforms ─────────────────────────────────────────────────────
  if (['udemy.com','coursera.org','edx.org','khanacademy.org','freecodecamp.org',
       'pluralsight.com','skillshare.com','linkedin.com/learning','brilliant.org',
       'codecademy.com','theodinproject.com','frontendmentor.io'].some(s => d.includes(s))) {
    return { category: 'Learning', productive: 1 };
  }

  // ── Communication ──────────────────────────────────────────────────────────
  if (d.includes('gmail.com') || d.includes('mail.google.com')) return { category: 'Communication', productive: 1 };
  if (d.includes('outlook.') || d.includes('office.com')) return { category: 'Communication', productive: 1 };
  if (d.includes('slack.com')) return { category: 'Communication', productive: 1 };
  if (d.includes('teams.microsoft.com') || d.includes('meet.google.com') || d.includes('zoom.us')) return { category: 'Communication', productive: 1 };
  // LinkedIn is professional social networking — not the same as Slack/email
  if (d.includes('linkedin.com')) {
    // Only count as Deep Work if clearly job searching or posting content
    if (t.includes('job') || t.includes('apply') || t.includes('posting') ||
        t.includes('article') || t.includes('newsletter')) {
      return { category: 'Deep Work', productive: 1 };
    }
    return { category: 'Social Media', productive: 0 };
  }
  if (d.includes('discord.com') || d.includes('telegram.org') || d.includes('whatsapp.com')) return { category: 'Communication', productive: 0 };

  // ── Pure entertainment ─────────────────────────────────────────────────────
  if (['netflix.com','hulu.com','disneyplus.com','hbomax.com','max.com',
       'primevideo.com','twitch.tv','crunchyroll.com','funimation.com'].some(s => d.includes(s))) {
    return { category: 'Entertainment', productive: 0 };
  }

  // ── Social media ──────────────────────────────────────────────────────────
  if (['instagram.com','facebook.com','tiktok.com','snapchat.com','pinterest.com',
       'tumblr.com','threads.net'].some(s => d.includes(s))) {
    return { category: 'Social Media', productive: 0 };
  }

  // ── Music / podcasts ──────────────────────────────────────────────────────
  if (d.includes('spotify.com') || d.includes('soundcloud.com') || d.includes('apple.com/music')) {
    // Podcasts that could be educational — use title
    if (LEARNING_TITLE_KEYWORDS.some(k => t.includes(k))) return { category: 'Learning', productive: 1 };
    return { category: 'Entertainment', productive: 0 };
  }

  // ── Download managers / CDN domains — not real work ─────────────────────
  if (d.includes('cdn1.') || d.includes('cdn2.') || d.includes('.cdn.') ||
      /^cdn\d*\./.test(d)) {
    return { category: 'Other', productive: 0 };
  }

  return null; // no domain rule matched
}

function guessCategory(appName, title) {
  // 1. Check user-saved override in DB
  if (db) {
    const rows = db.exec(`SELECT category, productive FROM categories WHERE lower(app_name) = lower(?)`, [appName]);
    if (rows.length && rows[0].values.length) {
      return { category: rows[0].values[0][0], productive: rows[0].values[0][1] };
    }
  }

  const n = (appName || '').toLowerCase();
  const t = (title  || '').toLowerCase();

  // 2. Idle — never count as productive, put in System
  if (n === 'idle' || n.includes('screen saver') || n.includes('screensaver') ||
      n.includes('lock screen') || t === 'idle') {
    return { category: 'System', productive: 0 };
  }

  // 3. File/document viewers — PDF, office files open in viewer apps
  if (n.includes('acrobat') || n.includes('pdf') || n.includes('sumatra') || n.includes('foxit')) {
    return { category: 'Documents', productive: 1 };
  }
  // App name ends in .pdf, .docx etc (file shown as window title)
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv)$/i.test(n) || /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv)$/i.test(t)) {
    return { category: 'Documents', productive: 1 };
  }

  // 4. Smart domain + title rules
  const domainResult = smartDomainRule(appName, title);
  if (domainResult) return domainResult;

  // 5. Title-based overrides for any site
  if (LEARNING_TITLE_KEYWORDS.some(k => t.includes(k))) return { category: 'Learning', productive: 1 };
  if (ENTERTAINMENT_TITLE_KEYWORDS.some(k => t.includes(k))) return { category: 'Entertainment', productive: 0 };

  // 6. Generic app name fallback
  // IP addresses (server/admin panels) → Deep Work
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(n)) {
    return { category: 'Deep Work', productive: 1 };
  }
  // Hosting/server control panels → Deep Work
  if (n.includes('cpanel') || n.includes('whm') || n.includes('vpspanel') ||
      n.includes('web-hosting') || n.includes('plesk') || n.includes('directadmin') ||
      n.includes('admin panel') || n.includes('control panel') || n.includes('webmin')) {
    return { category: 'Deep Work', productive: 1 };
  }
  if (['code','vscode','visual studio','xcode','vim','neovim','emacs','figma','photoshop',
       'illustrator','blender','github','stackoverflow','linear','vercel','netlify',
       'postman','insomnia','terminal','iterm','warp','hyper'].some(k => n.includes(k))) {
    return { category: 'Deep Work', productive: 1 };
  }
  if (['slack','zoom','teams','discord','mail','outlook','telegram','gmail','meet',
       'whatsapp','signal','skype','lync','webex','loom'].some(k => n.includes(k))) {
    return { category: 'Communication', productive: 1 };
  }
  if (['word','excel','powerpoint','notion','obsidian','docs','sheets','drive',
       'pages','numbers','keynote','onenote','evernote','bear','craft',
       'winword','powerpnt','mspub','visio','libreoffice','notepad','acrobat'].some(k => n.includes(k))) {
    return { category: 'Documents', productive: 1 };
  }
  if (['chrome','firefox','safari','edge','brave','opera','arc','vivaldi'].some(k => n.includes(k))) {
    return { category: 'Browsing', productive: 1 };
  }
  if (['youtube','netflix','vlc','mpv','iina','plex','steam','epic games','ea app',
       'spotify','apple music','music','twitch','crunchyroll','prime video'].some(k => n.includes(k))) {
    return { category: 'Entertainment', productive: 0 };
  }
  if (['twitter','reddit','facebook','instagram','tiktok','x.com','threads'].some(k => n.includes(k))) {
    return { category: 'Social Media', productive: 0 };
  }
  if (['explorer','finder','files','settings','control panel','task manager',
       'activity monitor','system preferences','spotlight','alfred','raycast',
       'powershell','cmd','bash','zsh','fish'].some(k => n.includes(k))) {
    return { category: 'System', productive: 1 };
  }
  // Any remaining value that looks like a domain → Browsing (better than Other)
  if (n.includes('.') && !n.includes(' ') && n.length < 60) {
    return { category: 'Browsing', productive: 0 };
  }

  return { category: 'Other', productive: 1 };
}

// ── Native app tracking ───────────────────────────────────────────────────────
let currentActivity = null;
let lastActiveTime = Date.now();
const IDLE_MS = 5 * 60 * 1000;
const POLL_MS = 6000;
let trackingInterval = null;

const BROWSER_PROCESSES = ['brave','chrome','firefox','safari','edge','opera','vivaldi'];

function isBrowserProcess(name) {
  const n = (name || '').toLowerCase();
  return BROWSER_PROCESSES.some(b => n.includes(b));
}

function startActivity(appName, windowTitle, url) {
  // If PowerShell returned a blank app name, use the window title as fallback
  // so the activity is at least labelled with something meaningful
  // Use PowerShell process name directly. Only fall back to title parsing
  // when PS returned nothing at all. Take the LAST segment of "File - AppName"
  // since window titles in Windows use "filename - AppName" format.
  const effectiveName = (appName && appName.trim() && appName !== 'Unknown')
    ? appName
    : (windowTitle
        ? windowTitle.split(' - ').pop().trim().substring(0, 60) || 'Unknown'
        : 'Unknown');
  db.run(`INSERT INTO activity (app_name, window_title, url, started_at) VALUES (?,?,?,?)`,
    [effectiveName, windowTitle || '', url || null, Date.now()]);
  const rows = db.exec(`SELECT last_insert_rowid() as id`);
  currentActivity = { id: rows[0].values[0][0], appName: effectiveName, windowTitle, startedAt: Date.now() };
  // Trigger AI classification for unknown apps (lands in Other) — async, non-blocking
  const _c = guessCategory(effectiveName, windowTitle);
  if (_c.category === 'Other') aiClassify(effectiveName, windowTitle).catch(() => {});
}

function endCurrentActivity() {
  if (currentActivity) {
    db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [Date.now(), currentActivity.id]);
    currentActivity = null;
  }
}

// Max gap between polls before we consider it a sleep/hibernate
const MAX_POLL_GAP_MS = POLL_MS * 4; // 24 seconds — 4 missed polls = something happened

let lastTickTime = Date.now();

let lastTickDate = new Date().toDateString(); // track calendar day

function tick() {
  if (!db) return;
  try {
    const now = Date.now();

    // ── Browser heartbeat timeout ─────────────────────────────────────────────
    if (currentBrowserActivity) {
      const lastSeen = currentBrowserActivity.lastHeartbeat || currentBrowserActivity.startedAt;
      if (now - lastSeen > 90000) {
        db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [lastSeen + 1000, currentBrowserActivity.id]);
        currentBrowserActivity = null;
        browserWindowFocused = false;
      }
    }

    // ── Background audio session timeouts ─────────────────────────────────────
    // End any background session we haven't heard from in 90s (audio stopped/tab closed)
    for (const [url, session] of backgroundAudioSessions) {
      if (now - session.lastSeen > 90000) {
        db.run('UPDATE activity SET ended_at=? WHERE id=?', [session.lastSeen + 1000, session.id]);
        backgroundAudioSessions.delete(url);
      }
    }

    // ── Midnight day-rollover ─────────────────────────────────────────────────
    const todayStr = new Date().toDateString();
    if (todayStr !== lastTickDate) {
      // A new calendar day has started — close any open activities at midnight
      const midnight = new Date(); midnight.setHours(0,0,0,0);
      const midnightTs = midnight.getTime();
      if (currentActivity) {
        db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [midnightTs, currentActivity.id]);
        currentActivity = null;
      }
      if (currentBrowserActivity) {
        db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [midnightTs, currentBrowserActivity.id]);
        currentBrowserActivity = null;
      }
      // Also end all background audio sessions at midnight
      endAllBackgroundSessions(midnightTs);
      lastTickDate = todayStr;
      lastActiveTime = now;
      saveDB();
      return; // let next tick start fresh activities for the new day
    }

    // ── Sleep/hibernate gap detection ────────────────────────────────────────
    const gap = now - lastTickTime;
    if (gap > MAX_POLL_GAP_MS) {
      // Large gap = system was asleep or screen was off
      // End any open activities — don't count the gap as active time
      if (currentActivity) endCurrentActivity();
      if (currentBrowserActivity) {
        db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [lastTickTime, currentBrowserActivity.id]);
        currentBrowserActivity = null;
      }
      lastActiveTime = now;
      lastTickTime = now;
      return;
    }
    lastTickTime = now;

    const win = getActiveWindow();
    if (!win) return;
    const rawAppName  = (win.owner?.name || '').trim();
    const windowTitle = (win.title || '').trim();

    // ── Idle / lock-screen detection ─────────────────────────────────────────
    // Windows reports PID 0 ("Idle" / "System Idle Process") when the screen is
    // locked or no user window is in the foreground. We must NOT create activity
    // rows for this — it would fill the Day Log with fake "Idle" time.
    const SYSTEM_IDLE_NAMES = ['idle','system idle process','system','dwm','winlogon',
      'logonui','lockapp','screensaver','screen saver','windows default lock screen'];
    const lowerRaw = rawAppName.toLowerCase();
    if (!rawAppName || rawAppName === 'Unknown' ||
        SYSTEM_IDLE_NAMES.some(n => lowerRaw === n || lowerRaw.includes(n))) {
      // Screen is locked / no foreground window — end whatever was open and stop
      if (currentActivity) endCurrentActivity();
      return;
    }

    // If PowerShell returned a non-idle but still blank effective name,
    // derive from window title as fallback — take the LAST segment since
    // Windows uses "filename - AppName" format
    const appName = rawAppName !== 'Unknown'
      ? rawAppName
      : (windowTitle ? windowTitle.split(' - ').pop().trim().substring(0, 60) || null : null);

    // Skip if we still have nothing meaningful
    if (!appName) return;

    if (appName.toLowerCase().includes('electron') || appName.toLowerCase().includes('daylens')) return;

    // If a browser is in focus, let the extension handle tracking
    if (isBrowserProcess(appName)) {
      if (currentActivity) { endCurrentActivity(); }
      lastActiveTime = now;
      return;
    }

    if (currentActivity && (now - lastActiveTime > IDLE_MS)) {
      endCurrentActivity();
      return;
    }
    lastActiveTime = now;

    if (!currentActivity || currentActivity.appName !== appName || currentActivity.windowTitle !== windowTitle) {
      endCurrentActivity();
      startActivity(appName, windowTitle);
    }
  } catch (e) {}
}

// ── Alive heartbeat — written to DB every 60s ─────────────────────────────
// Allows startup cleanup to know the last moment the app was genuinely running.
// If the laptop dies, this timestamp stays frozen at the last write.
let _aliveHeartbeatInterval = null;
function writeAliveTimestamp() {
  if (!db) return;
  try {
    const ts = Date.now();
    db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_alive', ?)", [ts.toString()]);
    // Also write a secondary 'last_alive_check' that we can compare against on next startup
    // to detect if the DB was tampered with or is from a different machine
    db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_alive_check', ?)", [(ts + 1).toString()]);
    saveDB();
  } catch(e) {}
}

function startTracking() {
  if (trackingInterval) return;
  setTimeout(tick, 1000);
  trackingInterval = setInterval(tick, POLL_MS);
  // Write alive timestamp immediately and then every 60s
  writeAliveTimestamp();
  _aliveHeartbeatInterval = setInterval(writeAliveTimestamp, 60 * 1000);
}

function stopTracking() {
  if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
  if (_aliveHeartbeatInterval) { clearInterval(_aliveHeartbeatInterval); _aliveHeartbeatInterval = null; }
  writeAliveTimestamp(); // final write on clean shutdown
  endCurrentActivity();
  if (currentBrowserActivity) {
    db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [Date.now(), currentBrowserActivity.id]);
    currentBrowserActivity = null;
  }
  saveDB();
}

// ── IPC ───────────────────────────────────────────────────────────────────────

// Helper: compute capped duration for a row within [dayStart, dayEnd]
// Prevents activities spanning midnight from bleeding into adjacent days
function cappedDur(startedAt, endedAt, dayStart, dayEnd) {
  const s = Math.max(startedAt, dayStart);
  const e = Math.min(endedAt || dayEnd, dayEnd);
  return Math.max(0, e - s);
}

ipcMain.handle('get-today', () => {
  if (!db) return [];
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const dayEnd   = Math.min(dayStart + 86400000, Date.now()); // cap at now, not midnight
  // Fetch all activities that overlap today (started today OR started before today but end after midnight)
  const rows = db.exec(`
    SELECT app_name, window_title, url, started_at,
           COALESCE(ended_at, ${Date.now()}) AS ended_at,
           COALESCE(is_background, 0) AS is_background
    FROM activity
    WHERE COALESCE(ended_at, ${Date.now()}) > ${dayStart}
      AND started_at < ${dayEnd}
    ORDER BY started_at ASC`);
  if (!rows.length) return [];
  return rows[0].values.map(v => {
    const obj = Object.fromEntries(rows[0].columns.map((c, i) => [c, v[i]]));
    // Clamp to today's boundary
    obj.started_at = Math.max(obj.started_at, dayStart);
    obj.ended_at   = Math.min(obj.ended_at,   dayEnd);
    return obj;
  }).filter(r => (r.ended_at - r.started_at) >= 1000); // ignore sub-1s noise
});

ipcMain.handle('get-summary', (_, days = 1) => {
  if (!db) return [];
  // Use strict calendar day boundaries, not rolling 24h window
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const dayEnd   = Math.min(dayStart + 86400000, Date.now());
  const since    = days === 1 ? dayStart : dayStart - (days - 1) * 86400000;

  // Pull raw rows so we can cap each one at its day boundary
  const rows = db.exec(`
    SELECT app_name, url, window_title, started_at,
           COALESCE(ended_at, ${Date.now()}) AS ended_at,
           COALESCE(is_background, 0) AS is_background
    FROM activity
    WHERE COALESCE(ended_at, ${Date.now()}) > ${since}
      AND started_at < ${dayEnd}
    ORDER BY started_at ASC`);
  if (!rows.length) return [];

  // Aggregate per app, capping each activity at day boundaries
  const appMap = {};
  for (const v of rows[0].values) {
    const obj = Object.fromEntries(rows[0].columns.map((c, i) => [c, v[i]]));
    // Clamp to [since, dayEnd]
    const s = Math.max(obj.started_at, since);
    const e = Math.min(obj.ended_at,   dayEnd);
    const dur = Math.max(0, e - s);
    if (dur <= 0) continue;
    if (obj.is_background) continue; // background audio shown in Day Log only
    if (!appMap[obj.app_name]) {
      appMap[obj.app_name] = { app_name: obj.app_name, url: obj.url, window_title: obj.window_title, total_ms: 0 };
    }
    appMap[obj.app_name].total_ms += dur;
    if (obj.window_title) appMap[obj.app_name].window_title = obj.window_title;
  }
  return Object.values(appMap)
    .sort((a, b) => b.total_ms - a.total_ms)
    .map(obj => ({ ...obj, ...guessCategory(obj.app_name, obj.window_title) }));
});

ipcMain.handle('get-weekly', () => {
  const result = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const dayStart = d.getTime();
    const dayEnd   = Math.min(dayStart + 86400000, now); // don't go past now for today
    // Fetch activities overlapping this day
    const rows = db ? db.exec(`
      SELECT app_name, window_title, started_at, COALESCE(ended_at, ${now}) AS ended_at
      FROM activity
      WHERE COALESCE(ended_at, ${now}) > ${dayStart}
        AND started_at < ${dayEnd}
        AND COALESCE(is_background, 0) = 0`) : [];
    const appMap = {};
    if (rows.length) {
      for (const v of rows[0].values) {
        const [app_name, window_title, startedAt, endedAt] = v;
        const s = Math.max(startedAt, dayStart);
        const e = Math.min(endedAt,   dayEnd);
        const dur = Math.max(0, e - s);
        if (dur <= 0) continue;
        if (!appMap[app_name]) appMap[app_name] = { app_name, window_title, total_ms: 0 };
        appMap[app_name].total_ms += dur;
      }
    }
    const apps = Object.values(appMap);
    const totalMs      = apps.reduce((s, r) => s + r.total_ms, 0);
    const productiveMs = apps.filter(r => guessCategory(r.app_name, r.window_title).productive)
                             .reduce((s, r) => s + r.total_ms, 0);
    result.push({ date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), totalMs, productiveMs, apps });
  }
  return result;
});

ipcMain.handle('get-current-activity', () => currentActivity || currentBrowserActivity);

ipcMain.handle('get-day-rows', (_, offset = 0) => {
  if (!db) return [];
  const target = new Date();
  target.setDate(target.getDate() + offset);
  target.setHours(0, 0, 0, 0);
  const dayStart = target.getTime();
  const dayEnd   = Math.min(dayStart + 86400000, Date.now());
  // Include activities that overlap the day, not just those that started in it
  const rows = db.exec(`
    SELECT app_name, window_title, url, started_at,
           COALESCE(ended_at, ${Date.now()}) AS ended_at,
           COALESCE(is_background, 0) AS is_background
    FROM activity
    WHERE COALESCE(ended_at, ${Date.now()}) > ${dayStart}
      AND started_at < ${dayEnd}
    ORDER BY started_at ASC`);
  if (!rows.length) return [];
  return rows[0].values.map(v => {
    const obj = Object.fromEntries(rows[0].columns.map((c, i) => [c, v[i]]));
    // Clamp to this day's boundaries
    obj.started_at = Math.max(obj.started_at, dayStart);
    obj.ended_at   = Math.min(obj.ended_at,   dayEnd);
    return obj;
  }).filter(r => r.ended_at > r.started_at);
});
ipcMain.handle('get-ws-port', () => WS_PORT);

ipcMain.handle('get-auto-start', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('set-auto-start', (_, val) => {
  app.setLoginItemSettings({ openAtLogin: !!val });
  return true;
});

// Returns ALL rows in categories table so renderer can do local lookups
// without an IPC round-trip per row.
ipcMain.handle('is-first-launch', () => {
  if (!db) return false;
  try {
    const rows = db.exec("SELECT value FROM app_state WHERE key='onboarding_done'");
    return !(rows.length && rows[0].values.length);
  } catch(e) { return false; }
});

ipcMain.handle('complete-onboarding', () => {
  if (!db) return;
  db.run("INSERT OR REPLACE INTO app_state (key,value) VALUES ('onboarding_done','1')");
  saveDB();
  return true;
});

ipcMain.handle('get-user-categories', () => {
  if (!db) return {};
  const rows = db.exec('SELECT app_name, category, productive FROM categories');
  if (!rows.length) return {};
  const map = {};
  for (const [app, cat, prod] of rows[0].values) {
    map[app.toLowerCase()] = { category: cat, productive: prod };
  }
  return map;
});

ipcMain.handle('set-category', (_, appName, category, productive) => {
  if (!db) return false;
  // user_override=1 means this won't be overwritten by future seed updates
  db.run(
    'INSERT INTO categories (app_name, category, productive, user_override) VALUES (?,?,?,1) ' +
    'ON CONFLICT(app_name) DO UPDATE SET category=excluded.category, productive=excluded.productive, user_override=1',
    [appName, category, productive ? 1 : 0]
  );
  saveDB();
  return true;
});

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;

function createWindow() {
  const startHidden = process.argv.includes('--hidden');
  mainWindow = new BrowserWindow({
    width: 1200, height: 780, minWidth: 900, minHeight: 600,
    backgroundColor: '#06070f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });
  mainWindow.on('close', e => {
    if (!app.isQuiting) { e.preventDefault(); mainWindow.hide(); }
  });
}

// ── Daily summary notification ────────────────────────────────────────────────
const SUMMARY_HOUR = 17; // 5:00 PM
const SUMMARY_MIN  = 0;
let summaryTimer = null;
let lastSummaryDate = null;

function buildSummaryData() {
  if (!db) return null;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const now = Date.now();
  const dayEnd = Math.min(dayStart + 86400000, now);

  // Use boundary-capped raw rows (same approach as get-summary)
  const rawRows = db.exec(`
    SELECT app_name, MAX(window_title) AS window_title, started_at,
           COALESCE(ended_at, ${now}) AS ended_at,
           COALESCE(is_background, 0) AS is_background
    FROM activity
    WHERE COALESCE(ended_at, ${now}) > ${dayStart}
      AND started_at < ${dayEnd}
      AND COALESCE(is_background, 0) = 0
    GROUP BY id
    ORDER BY started_at ASC
  `);

  if (!rawRows.length || !rawRows[0].values.length) return null;

  const appMap = {};
  for (const v of rawRows[0].values) {
    const [app_name, window_title, startedAt, endedAt] = v;
    const s   = Math.max(startedAt, dayStart);
    const e   = Math.min(endedAt,   dayEnd);
    const dur = Math.max(0, e - s);
    if (dur <= 0) continue;
    if (!appMap[app_name]) appMap[app_name] = { app_name, window_title, total_ms: 0 };
    appMap[app_name].total_ms += dur;
  }

  const apps = Object.values(appMap).sort((a, b) => b.total_ms - a.total_ms);
  const totalMs      = apps.reduce((s, r) => s + r.total_ms, 0);
  const productiveMs = apps.filter(r => guessCategory(r.app_name, r.window_title).productive)
                           .reduce((s, r) => s + r.total_ms, 0);
  const score = totalMs > 0 ? Math.round((productiveMs / totalMs) * 100) : 0;
  const top3  = apps.slice(0, 3);

  return { totalMs, productiveMs, score, top3, appCount: apps.length };
}

function msToHuman(ms) {
  if (!ms || ms < 0) return '0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor((ms % 60000) / 1000)}s`;
}

function scoreVerdict(score) {
  if (score >= 85) return '🏆 Outstanding day!';
  if (score >= 70) return '🎯 Great focus today';
  if (score >= 50) return '👍 Solid day overall';
  if (score >= 30) return '📈 Room to improve';
  return '💤 Light day — rest up!';
}

function fireDailySummary() {
  const today = new Date().toDateString();
  if (lastSummaryDate === today) return; // already fired today
  lastSummaryDate = today;

  const data = buildSummaryData();
  if (!data) {
    // No activity tracked — still notify
    const { Notification } = require('electron');
    const n = new Notification({
      title: '📊 DayLens Daily Summary',
      body: 'No activity tracked today. Start the app earlier tomorrow!',
      silent: false,
    });
    n.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
    n.show();
    return;
  }

  const { totalMs, productiveMs, score, top3, appCount } = data;
  const topLine   = scoreVerdict(score);
  const timeLine  = `${msToHuman(totalMs)} tracked · ${msToHuman(productiveMs)} productive · Score ${score}`;
  const appsLine  = top3.map(r => r.app_name).join(', ') + (appCount > 3 ? ` +${appCount - 3} more` : '');

  const { Notification } = require('electron');
  const n = new Notification({
    title: `📊 DayLens · ${topLine}`,
    body: `${timeLine}\n🔝 ${appsLine}`,
    silent: false,
  });
  n.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  n.show();
}

function scheduleSummary() {
  if (summaryTimer) clearTimeout(summaryTimer);

  const now    = new Date();
  const target = new Date();
  target.setHours(SUMMARY_HOUR, SUMMARY_MIN, 0, 0);

  // If we've already passed 5pm today, schedule for tomorrow
  if (now >= target) target.setDate(target.getDate() + 1);

  const msUntil = target - now;
  console.log(`[DayLens] Daily summary scheduled in ${Math.round(msUntil / 60000)} minutes`);

  summaryTimer = setTimeout(() => {
    fireDailySummary();
    scheduleSummary(); // reschedule for tomorrow
  }, msUntil);
}

// Allow manual trigger from renderer (for testing)
ipcMain.handle('trigger-summary', () => {
  const saved = lastSummaryDate;
  lastSummaryDate = null; // reset so it fires even if already fired today
  fireDailySummary();
  lastSummaryDate = saved; // restore so real schedule isn't broken
});

ipcMain.handle('get-summary-time', () => {
  const now    = new Date();
  const target = new Date();
  target.setHours(SUMMARY_HOUR, SUMMARY_MIN, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  return { hour: SUMMARY_HOUR, min: SUMMARY_MIN, nextFire: target.getTime() };
});

// Set app metadata for Windows taskbar / About panel
app.setAppUserModelId('app.daylens.desktop');

ipcMain.handle('export-pdf', async (_, { html, filename }) => {
  const { dialog } = require('electron');
  const defaultPath = path.join(app.getPath('downloads'), filename);

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF Report',
    defaultPath,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });

  if (canceled || !filePath) return { success: false, reason: 'canceled' };

  // Create a hidden BrowserWindow to render the HTML and print to PDF
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  const pdfBuffer = await pdfWin.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  pdfWin.destroy();
  fs.writeFileSync(filePath, pdfBuffer);
  shell.showItemInFolder(filePath);
  return { success: true, filePath };
});

ipcMain.handle('get-extension-info', () => {
  // Extension is bundled inside the app's resources
  const extPath = app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '../assets/extension');
  const exists = fs.existsSync(extPath);
  return { path: extPath, exists };
});

ipcMain.handle('open-extension-folder', () => {
  const extPath = app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '../assets/extension');
  shell.openPath(extPath);
  return extPath;
});

ipcMain.handle('open-browser-extensions', (_, browser) => {
  const urls = {
    brave:   'brave://extensions',
    chrome:  'chrome://extensions',
    edge:    'edge://extensions',
  };
  // shell.openExternal can't open chrome:// URLs directly — open via cmd
  const url = urls[browser] || urls.chrome;
  const { execSync } = require('child_process');
  try {
    if (browser === 'brave') {
      execSync(`start brave "${url}"`, { windowsHide: true });
    } else if (browser === 'edge') {
      execSync(`start msedge "${url}"`, { windowsHide: true });
    } else {
      execSync(`start chrome "${url}"`, { windowsHide: true });
    }
  } catch(e) {
    // fallback - just open folder
    shell.openPath(urls.brave ? path.join(process.resourcesPath, 'extension') : '');
  }
  return true;
});

// ── Screen lock / sleep / hibernate detection ─────────────────────────────────
function onSystemIdle() {
  writeAliveTimestamp(); // stamp the last known time before going idle/sleep
  // Screen locked, sleeping, or user walked away
  if (currentActivity) {
    endCurrentActivity();
  }
  if (currentBrowserActivity) {
    db.run(`UPDATE activity SET ended_at=? WHERE id=?`, [Date.now(), currentBrowserActivity.id]);
    currentBrowserActivity = null;
  }
  saveDB();
}

function onSystemResume() {
  // System woke up — reset lastActiveTime so we don't count sleep duration
  lastActiveTime = Date.now();
}

app.whenReady().then(async () => {
  // Hook OS-level power/lock events
  powerMonitor.on('lock-screen',   onSystemIdle);
  powerMonitor.on('suspend',       onSystemIdle);
  powerMonitor.on('shutdown',      onSystemIdle);
  powerMonitor.on('unlock-screen', onSystemResume);
  powerMonitor.on('resume',        onSystemResume);
  await initDB();
  createWindow();
  startTracking();
  startWebSocketServer();
  scheduleSummary();

  try {
    const iconPath = path.join(__dirname, '../assets/icon.png');
    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath);
      tray = new Tray(img.resize({ width: 16, height: 16 }));
      tray.setToolTip('DayLens');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open DayLens',        click: () => mainWindow?.show() },
        { label: 'Send Summary Now',     click: () => { lastSummaryDate = null; fireDailySummary(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
      ]));
      tray.on('double-click', () => mainWindow?.show());
    }
  } catch (e) {}
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') { stopTracking(); app.quit(); } });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else mainWindow?.show(); });
app.on('before-quit', stopTracking);
