// ── DayLens Browser Extension — Background Service Worker ────────────────────
const WS_URL = 'ws://127.0.0.1:43821';
const RECONNECT_DELAY = 5000;

let ws = null;
let connected = false;
let reconnectTimer = null;

// Active tab state
let currentTabId = null;
let currentUrl   = null;
let currentTitle = null;
let windowFocused = true;

// Background audio tracking
// Key = tabId, Value = { url, domain, title }
const backgroundAudioTabs = new Map();

// Domains worth tracking as background audio
const BACKGROUND_TRACKABLE = [
  'zoom.us','meet.google.com','teams.microsoft.com','webex.com',
  'gotomeeting.com','bluejeans.com','whereby.com','around.co',
  'meet.jit.si','discord.com','skype.com',
  'youtube.com','youtu.be','vimeo.com','loom.com',
  'udemy.com','coursera.org','khanacademy.org','linkedin.com',
  'pluralsight.com','skillshare.com','egghead.io'
];

function isBackgroundTrackable(url) {
  if (!url) return false;
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return BACKGROUND_TRACKABLE.some(d => domain.includes(d));
  } catch(e) { return false; }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      connected = true;
      clearTimeout(reconnectTimer);
      updateIcon(true);
      // Always query the active tab fresh on (re)connect.
      // Don't rely on in-memory state — the service worker may have been killed
      // and restarted, losing currentUrl/currentTabId entirely.
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (!tabs || !tabs.length) return;
        const tab = tabs[0];
        if (!isTrackable(tab.url)) return;
        // Update in-memory state
        currentTabId = tab.id;
        currentUrl   = tab.url;
        currentTitle = tab.title;
        windowFocused = true;
        sendEvent('tab_active', tab.url, tab.title);
      });
    };
    ws.onclose = () => {
      connected = false;
      updateIcon(false);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    };
    ws.onerror = () => { connected = false; updateIcon(false); };
  } catch (e) {
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
  }
}

function sendEvent(type, url, title) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    let domain = '';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch(e) {}
    ws.send(JSON.stringify({ type, url, title, domain, ts: Date.now() }));
  } catch(e) {}
}

function updateIcon(isConnected) {
  chrome.action.setTitle({
    title: isConnected ? 'DayLens — Connected ✓' : 'DayLens — Not connected (is the app running?)'
  });
}

// ── Tab tracking ──────────────────────────────────────────────────────────────
function isTrackable(url) {
  if (!url) return false;
  // Skip all browser internal pages
  if (url.startsWith('chrome://'))           return false;
  if (url.startsWith('brave://'))            return false;
  if (url.startsWith('edge://'))             return false;
  if (url.startsWith('firefox://'))          return false;
  if (url.startsWith('about:'))              return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('moz-extension://'))    return false;
  if (url === 'newtab' || url.endsWith('newtab'))  return false;
  if (!url.startsWith('http'))               return false; // must be http/https
  return true;
}

function onTabChange(tabId, url, title) {
  const sameTab = (currentTabId === tabId && currentUrl === url);
  if (sameTab) {
    if (title && title !== currentTitle) {
      currentTitle = title;
      if (isTrackable(url) && windowFocused) sendEvent('tab_updated', url, title);
    }
    return;
  }
  if (currentUrl && isTrackable(currentUrl)) sendEvent('tab_hidden', currentUrl, currentTitle);
  currentTabId = tabId;
  currentUrl   = url;
  currentTitle = title || url;
  if (isTrackable(url) && windowFocused) sendEvent('tab_active', url, title || url);

  // When a tab becomes active, it's no longer a background audio tab
  if (backgroundAudioTabs.has(tabId)) {
    backgroundAudioTabs.delete(tabId);
    sendEvent('background_audio_end', url, title);
  }
}

// Tab activated
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const win = await chrome.windows.get(windowId);
    if (!win.focused) return;
    const tab = await chrome.tabs.get(tabId);
    if (tab) onTabChange(tabId, tab.url, tab.title);
  } catch(e) {}
});

// Tab updated (navigation or title change)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Full page load completed
  if (changeInfo.status === 'complete' && tab.active) {
    onTabChange(tabId, tab.url, tab.title);
  }
  // SPA navigation: URL changed without a full reload (history.pushState etc.)
  // Chrome fires changeInfo.url in this case
  if (changeInfo.url && tab.active && tabId === currentTabId) {
    onTabChange(tabId, changeInfo.url, tab.title || currentTitle);
  }
  if (changeInfo.title && tabId === currentTabId && changeInfo.title !== currentTitle) {
    currentTitle = changeInfo.title;
    if (isTrackable(currentUrl) && windowFocused) sendEvent('tab_updated', currentUrl, changeInfo.title);
  }
  // Tab title changed while in background — update if we're tracking it
  if (changeInfo.title && !tab.active && backgroundAudioTabs.has(tabId)) {
    const entry = backgroundAudioTabs.get(tabId);
    entry.title = changeInfo.title;
    sendEvent('background_audio', entry.url, changeInfo.title);
  }
  // Audibility changed — re-check background tabs
  if ('audible' in changeInfo) {
    checkBackgroundAudio();
  }
});

// Tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    if (currentUrl && isTrackable(currentUrl)) sendEvent('tab_hidden', currentUrl, currentTitle);
    currentTabId = null; currentUrl = null; currentTitle = null;
  }
  if (backgroundAudioTabs.has(tabId)) {
    const entry = backgroundAudioTabs.get(tabId);
    sendEvent('background_audio_end', entry.url, entry.title);
    backgroundAudioTabs.delete(tabId);
  }
});

// ── Background audio detection ────────────────────────────────────────────────
// Scans all tabs for ones that are:
//   - NOT the currently active tab
//   - Currently playing audio (audible: true)
//   - On a trackable domain (meeting/webinar/video)
async function checkBackgroundAudio() {
  try {
    const tabs = await chrome.tabs.query({ audible: true });
    const seenTabIds = new Set();

    for (const tab of tabs) {
      // Skip the active foreground tab — it's already tracked normally
      if (tab.active && tab.id === currentTabId) continue;
      if (!isBackgroundTrackable(tab.url)) continue;

      seenTabIds.add(tab.id);

      const existing = backgroundAudioTabs.get(tab.id);
      if (!existing) {
        // New background audio tab discovered
        backgroundAudioTabs.set(tab.id, { url: tab.url, title: tab.title });
        sendEvent('background_audio', tab.url, tab.title);
      } else if (existing.title !== tab.title && tab.title) {
        // Title updated (e.g. YouTube video changed)
        existing.title = tab.title;
        sendEvent('background_audio', tab.url, tab.title);
      }
    }

    // End sessions for tabs that are no longer audible
    for (const [tabId, entry] of backgroundAudioTabs) {
      if (!seenTabIds.has(tabId)) {
        sendEvent('background_audio_end', entry.url, entry.title);
        backgroundAudioTabs.delete(tabId);
      }
    }
  } catch(e) {}
}

// ── Window focus ──────────────────────────────────────────────────────────────
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    windowFocused = false;
    if (currentUrl && isTrackable(currentUrl)) sendEvent('tab_hidden', currentUrl, currentTitle);
    sendEvent('window_blurred', '', '');
    // Background audio continues — don't end those sessions
  } else {
    try {
      const win = await chrome.windows.get(windowId, { populate: true });
      if (!win.focused) return;
      windowFocused = true;
      sendEvent('window_focused', '', '');
      const activeTab = win.tabs?.find(t => t.active);
      if (activeTab && isTrackable(activeTab.url)) {
        // If this tab was being tracked as background audio, stop that
        if (backgroundAudioTabs.has(activeTab.id)) {
          sendEvent('background_audio_end', activeTab.url, activeTab.title);
          backgroundAudioTabs.delete(activeTab.id);
        }
        currentTabId = activeTab.id;
        currentUrl   = activeTab.url;
        currentTitle = activeTab.title;
        sendEvent('tab_active', activeTab.url, activeTab.title);
      }
    } catch(e) {}
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────
connect();
// Get the current active tab reliably — works in service worker context
chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
  if (tabs && tabs.length > 0) {
    const tab = tabs[0];
    windowFocused = true;
    currentTabId  = tab.id;
    currentUrl    = tab.url;
    currentTitle  = tab.title;
    // Don't send tab_active here — ws might not be open yet.
    // The ws.onopen handler sends it once the connection is ready.
  }
});

// ── Keepalive + background audio poll ────────────────────────────────────────
// Runs every 25s:
//   1. Sends heartbeat to keep session alive (no new DB rows)
//   2. Polls for audible background tabs
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepalive') return;
  if (!connected) { connect(); return; }
  // Heartbeat
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() })); } catch(e) {}
  }
  // Poll for background audio
  checkBackgroundAudio();
});

// ── Popup state ───────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_state') {
    sendResponse({
      connected,
      url: currentUrl,
      title: currentTitle,
      focused: windowFocused,
      backgroundCount: backgroundAudioTabs.size
    });
  }
  return true;
});
