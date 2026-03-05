# Multi-Window Synchronization Implementation

## Overview

The Multi-Window Synchronization system coordinates tab sleep/wake states across multiple Chrome windows based on which window is currently focused. This ensures optimal resource usage by sleeping tabs in inactive windows while keeping the focused window's tabs awake.

## Architecture

### Component Hierarchy

```
Chrome Browser Events (window.onFocusChanged, tabs.onCreated, etc.)
         ↓
Service Worker (service-worker/index.js)
         ↓
ServiceWorkerManager (core state management)
         ↓
WindowSyncManager (multi-window coordination) ← [NEW COMPONENT]
         ↓
TabSleep / TabWake (individual tab operations)
```

### Data Flow

```
Window Focus Change
    ↓
handleWindowFocusChanged() [ServiceWorkerManager]
    ↓
handleActiveWindowChange() [WindowSyncManager]
    ↓
Identify old/new focused windows
    ↓
sleepWindowTabs() → ServiceWorkerManager.sleepTab()
wakeWindowTabs() → ServiceWorkerManager.wakeTab()
    ↓
Content Script (TabSleep/TabWake)
    ↓
Browser Tab State Updated
```

## WindowSyncManager Class

### Location
`src/utils/multi-window-sync.js`

### Key Responsibilities

1. **Window Focus Coordination**: Manages sleep/wake state when window focus changes
2. **Sleep Exceptions**: Enforces rules for tabs that should never sleep
3. **Configuration Management**: Stores and manages multi-window sync preferences
4. **State Broadcasting**: Reports status to UI components
5. **Operation Batching**: Groups multiple tab operations to reduce overhead
6. **Debouncing**: Handles rapid window switches gracefully

### Core Methods

#### `async initializeSync()`
- Called once when service worker starts
- Loads configuration from storage
- Initializes window states from Chrome API
- Sets up base state for synchronization

#### `async handleActiveWindowChange(oldWindowId, newWindowId)`
**Main synchronization logic**
- Entry point for window focus changes
- Orchestrates sleep/wake operations
- Debounces rapid window switches (configurable delay)
- Coordinates all windows:
  - Wakes tabs in newly focused window
  - Sleeps tabs in previously focused window
  - Sleeps tabs in all other inactive windows
- Broadcasts state changes to UI

#### `async sleepWindowTabs(windowId, exceptions)`
- Sleeps all non-exception tabs in a window
- Respects exceptions:
  - `pinned: true` - Don't sleep pinned tabs
  - `whitelisted: true` - Don't sleep whitelist URLs
- Batches operations for efficiency
- Prevents thrashing with operation tracking

#### `async wakeWindowTabs(windowId)`
- Wakes all sleeping tabs in a window
- Only wakes tabs that are in 'sleeping' state
- Batches operations
- Updates window state tracking

#### `async getWindowSyncStatus(windowId)`
Returns detailed status for a single window:
```javascript
{
  windowId: number,
  isActive: boolean,
  tabs: [
    {
      id: number,
      title: string,
      url: string,
      pinned: boolean,
      state: 'awake' | 'sleeping' | 'unknown',
      skipped: boolean,
      skipReason: string | null
    }
  ],
  summary: {
    total: number,
    awake: number,
    sleeping: number,
    skipped: number
  }
}
```

#### `async getGlobalSyncStatus()`
Returns aggregated status across all windows:
```javascript
{
  config: { /* sync configuration */ },
  currentFocusedWindowId: number,
  windows: [ /* array of window status objects */ ],
  summary: {
    totalWindows: number,
    focusedWindows: number,
    unfocusedWindows: number,
    totalTabs: number,
    awakeTabs: number,
    sleepingTabs: number,
    skippedTabs: number
  }
}
```

## Configuration System

### Default Configuration
```javascript
{
  enableMultiWindowSync: true,           // Master control flag
  sleepInactiveWindowsAfterMs: 0,       // Delay before sleeping (0 = immediate)
  allowPinnedTabsToStayAwake: true,     // Always true (pinned tabs never sleep)
  whitelist: []                          // URLs that never sleep
}
```

### Storage
- Persisted to `chrome.storage.local` under key `multiWindowSyncConfig`
- Whitelist also stored in `preferences.whitelist`
- Loaded on service worker initialization

### Methods
- `async loadSyncConfig()` - Load from storage
- `async saveSyncConfig()` - Persist to storage
- `async updateSyncConfig(newConfig)` - Update and persist

## Sleep Exception Rules

### Unsleepable URLs (Never Sleep)
1. `chrome://` pages (settings, extensions, etc.)
2. `about:*` pages (about:blank, about:home, etc.)
3. `chrome-extension://` pages (extension UI)

### Whitelist URLs (User-Configured)
- Dynamic list stored in preferences
- Supports both literal domain matching and regex patterns
- Examples:
  - `gmail.com` - Matches any URL containing "gmail.com"
  - `https://.*\.github\.com` - Regex pattern for GitHub subdomains

### Pinned Tabs
- Always stay awake (controlled by `allowPinnedTabsToStayAwake` config)
- Indicated by `tab.pinned === true`

## Operation Tracking

### Purpose
Prevents race conditions when multiple operations affect the same window simultaneously

### Mechanism
```javascript
this.operationInProgress = new Set(); // Set of windowIds with ongoing ops
```

- Add windowId before starting operation
- Remove after operation completes
- Skip if already in progress (queue/defer pattern available)

### Debouncing Window Switches
```javascript
this.windowSwitchTimeout = null;     // Stores timeout ID
this.syncConfig.sleepInactiveWindowsAfterMs = 0; // Configurable delay
```

- Clears previous timeout when window changes again
- Waits for delay period before executing sleep/wake
- Prevents thrashing during rapid window switching

## Integration Points

### With ServiceWorkerManager
```javascript
// WindowSyncManager has reference to ServiceWorkerManager
this.swManager = serviceWorkerManager;

// Uses these methods:
await this.swManager.sleepTab(tabId);
await this.swManager.wakeTab(tabId);
await this.swManager.saveStorage();
await this.swManager.initializeWindowState(windowId);

// Accesses these properties:
this.swManager.storage.tabStates
this.swManager.storage.windowStates
```

### With ServiceWorker Event Handlers
```javascript
// service-worker/index.js hooks into window focus:
chrome.windows.onFocusChanged.addListener((windowId) => {
  this.handleWindowFocusChanged(windowId);
});

// Which delegates to WindowSyncManager:
async handleWindowFocusChanged(windowId) {
  const oldWindowId = this.windowSyncManager.currentFocusedWindowId;
  await this.windowSyncManager.handleActiveWindowChange(oldWindowId, windowId);
  // ... update basic state
}
```

### With Popup/UI
```javascript
// Message-based communication
chrome.runtime.sendMessage({
  action: 'getMultiWindowSyncStatus'
}, (response) => {
  // response.status contains full sync state
});

// Update configuration
chrome.runtime.sendMessage({
  action: 'updateMultiWindowSyncConfig',
  config: { enableMultiWindowSync: true }
});

// Receive status updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'multiWindowSyncStatusUpdate') {
    console.log('Sync status:', message.status);
  }
});
```

## Edge Case Handling

### Rapid Window Switching
**Problem**: User rapidly switches between windows
**Solution**: 
- Debounce mechanism with configurable delay
- Previous timeout cleared when new focus event arrives
- Operations grouped into single batch after delay

### Window Closed During Sync
**Problem**: Window closed while sleep/wake operations in progress
**Solution**:
- Chrome API handles gracefully (tab/window not found = no-op)
- Error handlers catch and log without crashing
- Operation tracking cleaned up automatically

### Tab Moved Between Windows
**Problem**: Tab dragged from one window to another
**Solution**: Method available to re-evaluate sync state
```javascript
await windowSyncManager.handleTabMovedBetweenWindows(
  tabId, 
  oldWindowId, 
  newWindowId
);
```
- Wakes tab if moved to focused window
- Sleeps tab if moved to unfocused window
- Respects exceptions

### All Windows Minimized
**Problem**: All windows lose focus (focus = -1)
**Solution**:
- Mark all windows as inactive
- Don't sleep/wake tabs (preserve state)
- Resume normal operation when focus returns

### User Switches Away from Chrome
**Problem**: Focus moves to another app (windowId = -1)
**Solution**:
- Mark all windows as inactive
- Don't take action (tabs remain in current state)
- Transparent to system

## Performance Considerations

### Batching Operations
```javascript
// Collect all tabs to sleep first
const tabsToSleep = [];
for (const tab of tabs) {
  if (!shouldSkip(tab)) {
    tabsToSleep.push(tab.id);
  }
}

// Then execute in batch
for (const tabId of tabsToSleep) {
  await swManager.sleepTab(tabId);
}
```
**Benefit**: Reduces message passing overhead

### Debouncing
```javascript
if (this.windowSwitchTimeout) {
  clearTimeout(this.windowSwitchTimeout);
}
this.windowSwitchTimeout = setTimeout(async () => {
  // Execute after 0ms (or configured delay)
}, this.syncConfig.sleepInactiveWindowsAfterMs);
```
**Benefit**: Avoids multiple sleep/wake cycles for rapid switches

### Caching Tab Lists
- Chrome API queries are asynchronous
- Results available immediately after cached from Chrome

### Minimal State Updates
- Only update storage when state actually changes
- Avoid redundant database writes

## Testing Scenarios

### Scenario 1: Basic Window Switch
1. User opens 2 windows (A, B)
2. Window A focused, tabs awake
3. Switch focus to window B
4. Expected: Tabs in A sleep, tabs in B wake

### Scenario 2: Pinned Tab Exception
1. Window A has pinned and unpinned tabs
2. Switch focus away from A
3. Expected: Unpinned tabs sleep, pinned tabs stay awake

### Scenario 3: Whitelist Exception
1. Gmail tab in inactive window
2. Gmail URL in whitelist
3. Expected: Tab stays awake despite window being inactive

### Scenario 4: Rapid Switching
1. User rapidly switches A → B → A → B
2. Expected: Single batch operation at end, no thrashing

### Scenario 5: Window Closed
1. Window A becoming closed during sleep operation
2. Expected: No errors, graceful handling

## Debugging

### Enable Detailed Logging
The `log()` function from utils.js is used throughout:
```javascript
log('WindowSyncManager: Message', { detail: 'value' });
```

### Inspect Global State
In browser DevTools:
```javascript
// Access service worker
await chrome.runtime.sendMessage({ action: 'getMultiWindowSyncStatus' });

// Or directly if exposed:
globalThis.infinityManager.windowSyncManager.getGlobalSyncStatus();
```

### Monitor Storage
```javascript
chrome.storage.local.get(['multiWindowSyncConfig', 'tabStates', 'windowStates'], console.log);
```

## Future Enhancements

1. **WebSocket Detection**: Identify tabs with active WebSocket connections and skip sleeping
2. **Network Activity Detection**: Monitor tabs for active network operations
3. **User Idle Detection**: Only sleep after user idle for configurable duration
4. **Smart Whitelist Management**: UI for managing whitelist entries
5. **Per-Window Policies**: Different rules for different windows/profiles
6. **Sleep Delay Configuration**: Gradual sleep after delay instead of immediate
7. **Memory Optimization**: Monitor extension memory usage and adjust aggressively if needed
8. **Analytics**: Track which URLs are skipped and why

## Related Files

- `src/service-worker/index.js` - ServiceWorkerManager, event hooks
- `src/utils.js` - Utility functions (log, storage, Chrome API wrappers)
- `src/tab-sleep.js` - TabSleep class (content script side)
- `src/utils/tab-wake.js` - TabWake utilities
- `public/manifest.json` - Extension permissions

## Summary

WindowSyncManager provides intelligent, efficient coordination of tab sleep/wake states across multiple Chrome windows. It handles complex edge cases gracefully while maintaining high performance through batching, debouncing, and smart exception handling. The system integrates cleanly with the existing ServiceWorkerManager and TabSleep/TabWake components through well-defined interfaces.
