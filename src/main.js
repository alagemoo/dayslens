const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');

const initSqlJs = require('sql.js');

let db = null;
const userDataPath = app.getPath('userData');
const DB_PATH = path.join(userDataPath, 'daylens.db');

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
      ended_at     INTEGER
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
    ['Windows Explorer','System',1],['Task Manager','System',1],
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
    ['zoom.us','Communication',1],['linkedin.com','Communication',1],
    ['google.com','Browsing',1],['wikipedia.org','Browsing',1],
  ];
  for (const [a, c, p] of seeds) {
    db.run(`INSERT OR IGNORE INTO categories (app_name, category, productive) VALUES (?,?,?)`, [a, c, p]);
  }

  // ── Startup cleanup: close any stale open activities ──────────────────────
  // Caps unclosed rows at 15 min max, clamped to their day's midnight.
  // Prevents crashed sessions from bleeding hours into today's totals.
  const IDLE_MAX_MS = 15 * 60 * 1000;
  const _now = Date.now();
  db.run(`
    UPDATE activity
    SET ended_at = MIN(started_at + ${IDLE_MAX_MS},
                       (((started_at / 86400000) + 1) * 86400000))
    WHERE ended_at IS NULL
      AND started_at < ${_now - IDLE_MAX_MS}
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

    socket.on('data', buf => {
      try {
        const msg = decodeWsFrame(buf);
        if (!msg) return;
        const data = JSON.parse(msg);
        handleBrowserEvent(data);
      } catch (e) {}
    });

    socket.on('close', () => wsClients.delete(socket));
    socket.on('error', () => { socket.destroy(); wsClients.delete(socket); });
  });

  wsServer.listen(WS_PORT, '127.0.0.1', () => {
    console.log(`[DayLens] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
  });

  wsServer.on('error', e => {
    console.error('[DayLens] WebSocket server error:', e.message);
  });
}

function decodeWsFrame(buf) {
  if (buf.length < 2) return null;
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) { payloadLen = buf.readUInt16BE(2); offset = 4; }
  else if (payloadLen === 127) { payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10; }
  if (!masked) return buf.slice(offset, offset + payloadLen).toString('utf8');
  const mask = buf.slice(offset, offset + 4); offset += 4;
  const payload = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) payload[i] = buf[offset + i] ^ mask[i % 4];
  return payload.toString('utf8');
}

// ── Browser event handler ─────────────────────────────────────────────────────
let currentBrowserActivity = null;
let browserWindowFocused = true; // track if browser window has focus

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
    return;
  }

  // Heartbeat — just refresh the idle timer so the open row stays valid
  if (type === 'heartbeat') {
    if (currentBrowserActivity) {
      // Update startedAt reference so IDLE_MS cap doesn't prematurely close it
      currentBrowserActivity.lastHeartbeat = now;
    }
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
  if (d.includes('notion.so')) return { category: 'Documents', productive: 1 };
  if (d.includes('obsidian.md')) return { category: 'Documents', productive: 1 };

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
  if (d.includes('linkedin.com')) return { category: 'Communication', productive: 1 };
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
  if (['code','vscode','visual studio','xcode','vim','neovim','emacs','figma','photoshop',
       'illustrator','blender','github','stackoverflow','linear','vercel','netlify',
       'postman','insomnia','terminal','iterm','warp','hyper'].some(k => n.includes(k))) {
    return { category: 'Deep Work', productive: 1 };
  }
  if (['slack','zoom','teams','discord','mail','outlook','telegram','gmail','meet',
       'whatsapp','signal','skype'].some(k => n.includes(k))) {
    return { category: 'Communication', productive: 1 };
  }
  if (['word','excel','powerpoint','notion','obsidian','docs','sheets','drive',
       'pages','numbers','keynote','onenote','evernote','bear','craft'].some(k => n.includes(k))) {
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
  db.run(`INSERT INTO activity (app_name, window_title, url, started_at) VALUES (?,?,?,?)`,
    [appName, windowTitle || '', url || null, Date.now()]);
  const rows = db.exec(`SELECT last_insert_rowid() as id`);
  currentActivity = { id: rows[0].values[0][0], appName, windowTitle, startedAt: Date.now() };
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
    const appName = (win.owner?.name || 'Unknown').trim();
    const windowTitle = (win.title || '').trim();

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

function startTracking() {
  if (trackingInterval) return;
  setTimeout(tick, 1000);
  trackingInterval = setInterval(tick, POLL_MS);
}

function stopTracking() {
  if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
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
           COALESCE(ended_at, ${Date.now()}) AS ended_at
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
  }).filter(r => r.ended_at > r.started_at);
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
           COALESCE(ended_at, ${Date.now()}) AS ended_at
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
        AND started_at < ${dayEnd}`) : [];
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
           COALESCE(ended_at, ${Date.now()}) AS ended_at
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

ipcMain.handle('set-category', (_, appName, category, productive) => {
  if (!db) return false;
  db.run(`INSERT INTO categories (app_name, category, productive) VALUES (?,?,?)
          ON CONFLICT(app_name) DO UPDATE SET category=excluded.category, productive=excluded.productive`,
    [appName, category, productive ? 1 : 0]);
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
           COALESCE(ended_at, ${now}) AS ended_at
    FROM activity
    WHERE COALESCE(ended_at, ${now}) > ${dayStart}
      AND started_at < ${dayEnd}
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
