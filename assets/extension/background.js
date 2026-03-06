// ── DayLens Browser Extension — Background Service Worker ────────────────────
const WS_URL = 'ws://127.0.0.1:43821';
const RECONNECT_DELAY = 5000;

let ws = null;
let connected = false;
let reconnectTimer = null;

// Current active tab state
let currentTabId = null;
let currentUrl = null;
let currentTitle = null;

// Is the browser window currently in focus?
let windowFocused = true;

// ── WebSocket connection ──────────────────────────────────────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      connected = true;
      clearTimeout(reconnectTimer);
      updateIcon(true);
      if (currentUrl && windowFocused) sendEvent('tab_active', currentUrl, currentTitle);
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
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
    ws.send(JSON.stringify({ type, url, title, domain, ts: Date.now() }));
  } catch (e) {}
}

function updateIcon(isConnected) {
  chrome.action.setTitle({
    title: isConnected ? 'DayLens — Connected ✓' : 'DayLens — Not connected (is the app running?)'
  });
}

// ── Tab tracking ──────────────────────────────────────────────────────────────
function isTrackable(url) {
  if (!url) return false;
  if (url.startsWith('chrome://')) return false;
  if (url.startsWith('brave://')) return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('about:')) return false;
  if (url === 'newtab') return false;
  return true;
}

function onTabChange(tabId, url, title) {
  const sameTab = (currentTabId === tabId && currentUrl === url);
  if (sameTab) {
    // Same tab — only fire if title changed (e.g. YouTube video changed)
    if (title && title !== currentTitle) {
      currentTitle = title;
      if (isTrackable(url) && windowFocused) sendEvent('tab_updated', url, title);
    }
    return;
  }
  // Different tab — end previous, start new
  if (currentUrl && isTrackable(currentUrl)) sendEvent('tab_hidden', currentUrl, currentTitle);
  currentTabId = tabId;
  currentUrl = url;
  currentTitle = title || url;
  if (isTrackable(url) && windowFocused) sendEvent('tab_active', url, title || url);
}

// Tab activated (user switches tabs)
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const win = await chrome.windows.get(windowId);
    if (!win.focused) return; // only track focused window
    const tab = await chrome.tabs.get(tabId);
    if (tab) onTabChange(tabId, tab.url, tab.title);
  } catch (e) {}
});

// Tab updated (navigation within same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return; // only the active tab matters
  if (changeInfo.status === 'complete') onTabChange(tabId, tab.url, tab.title);
  if (changeInfo.title && tabId === currentTabId && changeInfo.title !== currentTitle) {
    currentTitle = changeInfo.title;
    if (isTrackable(currentUrl) && windowFocused) sendEvent('tab_updated', currentUrl, changeInfo.title);
  }
});

// Tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    if (currentUrl && isTrackable(currentUrl)) sendEvent('tab_hidden', currentUrl, currentTitle);
    currentTabId = null; currentUrl = null; currentTitle = null;
  }
});

// ── Window focus tracking — THE KEY FIX ──────────────────────────────────────
// When the user switches to another app, the browser loses focus.
// We send tab_hidden so the desktop stops counting that tab.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — stop counting current tab
    windowFocused = false;
    if (currentUrl && isTrackable(currentUrl)) sendEvent('tab_hidden', currentUrl, currentTitle);
    sendEvent('window_blurred', '', '');
  } else {
    // Browser gained focus — resume tracking active tab
    try {
      const win = await chrome.windows.get(windowId, { populate: true });
      if (!win.focused) return;
      windowFocused = true;
      sendEvent('window_focused', '', '');
      const activeTab = win.tabs?.find(t => t.active);
      if (activeTab && isTrackable(activeTab.url)) {
        currentTabId = activeTab.id;
        currentUrl   = activeTab.url;
        currentTitle = activeTab.title;
        sendEvent('tab_active', activeTab.url, activeTab.title);
      }
    } catch (e) {}
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────
connect();
chrome.windows.getCurrent({ populate: true }, (win) => {
  if (win && win.focused) {
    windowFocused = true;
    const activeTab = win.tabs?.find(t => t.active);
    if (activeTab) onTabChange(activeTab.id, activeTab.url, activeTab.title);
  }
});

// ── Keepalive ping ────────────────────────────────────────────────────────────
// Keeps the service worker alive every 25s.
// Sends a simple 'heartbeat' — NOT 'tab_active' — so no new DB rows are created.
// The desktop app tracks open sessions via rows with no ended_at.
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepalive') return;
  if (!connected) { connect(); return; }
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() })); } catch (e) {}
  }
});

// ── Popup state ───────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_state') {
    sendResponse({ connected, url: currentUrl, title: currentTitle, focused: windowFocused });
  }
  return true;
});
