/**
 * Service Worker for Infinity Chrome Extension
 * 
 * Manages tab state across windows with sleep/wake functionality
 * Handles global state persistence and event synchronization
 */

import WindowSyncManager from '../utils/multi-window-sync.js';
import { getTabCapture } from '../utils/tab-capture.js';

/**
 * @typedef {Object} TabState
 * @property {number} tabId - Chrome tab ID
 * @property {number} windowId - Chrome window ID
 * @property {'awake'|'sleeping'|'discarded'} state - Current state
 * @property {string|null} preview - Base64-encoded preview image
 * @property {string} originalUrl - Tab's original URL
 * @property {string} title - Tab title
 * @property {string} favicon - Favicon URL
 * @property {Object} savedState - Saved page state (DOM, scroll position, etc)
 * @property {number} lastActive - Timestamp of last activity
 */

/**
 * @typedef {Object} WindowState
 * @property {number} windowId - Chrome window ID
 * @property {boolean} isActive - Whether window is in focus
 * @property {number[]} tabs - Array of tab IDs in this window
 */

/**
 * @typedef {Object} StorageData
 * @property {Object.<number, TabState>} tabStates - Map of tabId to TabState
 * @property {Object.<number, WindowState>} windowStates - Map of windowId to WindowState
 * @property {Object} preferences - User preferences
 */

class ServiceWorkerManager {
  constructor() {
    this.storage = {
      tabStates: {},
      windowStates: {},
      preferences: {
        sleepThreshold: 15000, // 15 seconds
        memoryTarget: 100,
        whitelist: [],
        enabledDomains: [],
      },
    };

    this.messageHandlers = {
      capturePreview: this.handleCapturePreview.bind(this),
      saveTabs: this.handleSaveTabs.bind(this),
      restoreTabs: this.handleRestoreTabs.bind(this),
      reportMemory: this.handleReportMemory.bind(this),
      getSleepStats: this.handleGetSleepStats.bind(this),
      getSleepTarget: this.handleGetSleepTarget.bind(this),
      getMultiWindowSyncStatus: this.handleGetMultiWindowSyncStatus.bind(this),
      updateMultiWindowSyncConfig: this.handleUpdateMultiWindowSyncConfig.bind(this),
      captureTabPreviewRequest: this.handleCaptureTabPreviewRequest.bind(this),
      getPreviewStats: this.handleGetPreviewStats.bind(this),
      getPreferences: this.handleGetPreferences.bind(this),
      updatePreferences: this.handleUpdatePreferences.bind(this),
    };

    // Initialize WindowSyncManager for multi-window coordination
    this.windowSyncManager = new WindowSyncManager(this);
  }

  /**
   * Initialize the service worker
   */
  async init() {
    await this.loadStorage();
    await this.discoverExistingTabs();
    this.setupEventListeners();
    this.setupInactiveTabAlarm();
    await this.windowSyncManager.initializeSync();
    console.log('[Infinity] Service Worker initialized');
  }

  /**
   * Discover all existing tabs/windows and populate state.
   * Also reconciles stored state by removing entries for tabs/windows
   * that no longer exist in Chrome (prevents phantom accumulation).
   */
  async discoverExistingTabs() {
    try {
      const windows = await chrome.windows.getAll({ populate: true });

      // Collect the set of real tab and window IDs
      const realTabIds = new Set();
      const realWindowIds = new Set();

      for (const win of windows) {
        if (win.type !== 'normal') continue;
        realWindowIds.add(win.id);

        this.storage.windowStates[win.id] = {
          windowId: win.id,
          isActive: win.focused,
          tabs: win.tabs.map(t => t.id),
        };

        for (const tab of win.tabs) {
          realTabIds.add(tab.id);
          if (!this.storage.tabStates[tab.id]) {
            this.initializeTabState(tab);
          }
        }
      }

      // Prune tab states that no longer correspond to open tabs
      const staleTabIds = [];
      for (const tabIdStr of Object.keys(this.storage.tabStates)) {
        const tabId = Number(tabIdStr);
        if (!realTabIds.has(tabId)) {
          staleTabIds.push(tabIdStr);
          delete this.storage.tabStates[tabIdStr];
        }
      }

      // Prune window states for windows that no longer exist
      for (const windowIdStr of Object.keys(this.storage.windowStates)) {
        const windowId = Number(windowIdStr);
        if (!realWindowIds.has(windowId)) {
          delete this.storage.windowStates[windowIdStr];
        }
      }

      // Clean up orphaned preview_* keys from storage
      if (staleTabIds.length > 0) {
        try {
          const previewKeysToRemove = staleTabIds.map(id => `preview_${id}`);
          await chrome.storage.local.remove(previewKeysToRemove);
          console.log(`[Infinity] Pruned ${staleTabIds.length} stale tab states and their previews`);
        } catch (e) {
          console.warn('[Infinity] Error cleaning up orphaned previews:', e);
        }
      }

      await this.saveStorage();
      console.log(`[Infinity] Discovered ${Object.keys(this.storage.tabStates).length} tabs across ${windows.length} windows`);
    } catch (error) {
      console.error('[Infinity] Error discovering existing tabs:', error);
    }
  }

  /**
   * Load persistent storage from chrome.storage.local
   */
  async loadStorage() {
    try {
      const stored = await chrome.storage.local.get(['tabStates', 'windowStates', 'preferences']);
      if (stored.tabStates) {
        this.storage.tabStates = stored.tabStates;
      }
      if (stored.windowStates) {
        this.storage.windowStates = stored.windowStates;
      }
      if (stored.preferences) {
        this.storage.preferences = { ...this.storage.preferences, ...stored.preferences };
      }
    } catch (error) {
      console.error('[Infinity] Failed to load storage:', error);
    }
  }

  /**
   * Save storage to chrome.storage.local
   */
  async saveStorage() {
    try {
      await chrome.storage.local.set({
        tabStates: this.storage.tabStates,
        windowStates: this.storage.windowStates,
        preferences: this.storage.preferences,
      });
    } catch (error) {
      console.error('[Infinity] Failed to save storage:', error);

      // If quota exceeded, attempt emergency cleanup and retry
      if (error.message && error.message.includes('quota')) {
        console.warn('[Infinity] Quota exceeded — running emergency cleanup');
        try {
          // Remove all preview_* keys to free space
          const allData = await chrome.storage.local.get(null);
          const previewKeys = Object.keys(allData).filter(k => k.startsWith('preview_'));
          if (previewKeys.length > 0) {
            await chrome.storage.local.remove(previewKeys);
            console.log(`[Infinity] Emergency cleanup removed ${previewKeys.length} preview keys`);
          }
          // Retry the save
          await chrome.storage.local.set({
            tabStates: this.storage.tabStates,
            windowStates: this.storage.windowStates,
            preferences: this.storage.preferences,
          });
          console.log('[Infinity] Save succeeded after emergency cleanup');
        } catch (retryError) {
          console.error('[Infinity] Save failed even after emergency cleanup:', retryError);
        }
      }
    }
  }

  /**
   * Setup all event listeners
   */
  /**
   * Setup alarm-based inactive tab checker.
   * Uses chrome.alarms so it survives service worker restarts.
   */
  setupInactiveTabAlarm() {
    const ALARM_NAME = 'infinity-inactive-tab-check';

    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM_NAME) {
        this.sleepInactiveTabs();
      }
    });

    console.log('[Infinity] Inactive tab alarm registered');
  }

  /**
   * Check all tabs and sleep any that have been inactive longer than sleepThreshold.
   * Skips the active tab in each window, pinned tabs, whitelisted/unsleepable URLs,
   * and tabs that are already sleeping.
   */
  async sleepInactiveTabs() {
    try {
      const threshold = this.storage.preferences.sleepThreshold;
      if (!threshold || threshold <= 0) return;

      const now = Date.now();
      const windows = await chrome.windows.getAll({ populate: true });

      for (const win of windows) {
        if (win.type !== 'normal') continue;

        for (const tab of win.tabs) {
          // Never sleep the active tab in any window
          if (tab.active) continue;

          const tabState = this.storage.tabStates[tab.id];
          if (!tabState || tabState.state === 'sleeping' || tabState.state === 'discarded') continue;

          // Respect existing skip rules
          if (this.windowSyncManager.shouldSkipTab(tab, { pinned: true, whitelisted: true })) {
            continue;
          }

          const inactiveMs = now - (tabState.lastActive || 0);
          if (inactiveMs >= threshold) {
            console.log(`[Infinity] Auto-discarding inactive tab ${tab.id} (${tab.title}) - inactive for ${Math.round(inactiveMs / 60000)}m`);
            await this.discardTab(tab.id);
          }
        }
      }
    } catch (error) {
      console.error('[Infinity] Error in sleepInactiveTabs:', error);
    }
  }

  setupEventListeners() {
    // Tab activation
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabActivated(activeInfo);
    });

    // Tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabRemoved(tabId);
    });

    // Tab updated (navigation, title change)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdated(tabId, changeInfo, tab);
    });

    // Tab creation
    chrome.tabs.onCreated.addListener((tab) => {
      this.handleTabCreated(tab);
    });

    // Window focus change
    chrome.windows.onFocusChanged.addListener((windowId) => {
      this.handleWindowFocusChanged(windowId);
    });

    // Message handling
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Enable async response
    });
  }

  /**
   * Handle tab activation
   */
  async handleTabActivated(activeInfo) {
    const { tabId, windowId } = activeInfo;

    try {
      const tab = await chrome.tabs.get(tabId);

      // Update tab state
      if (!this.storage.tabStates[tabId]) {
        this.initializeTabState(tab);
      }

      const tabState = this.storage.tabStates[tabId];
      tabState.lastActive = Date.now();

      // When a discarded tab is activated, Chrome auto-reloads it — update our state
      if (tabState.state === 'discarded') {
        tabState.state = 'awake';
        console.log(`[Infinity] Discarded tab reactivated: ${tabId}`);
      }
      // Don't auto-wake sleeping tabs on activation; require a click on suspended.html

      // Update window state
      if (!this.storage.windowStates[windowId]) {
        await this.initializeWindowState(windowId);
      }
      this.storage.windowStates[windowId].isActive = true;

      await this.saveStorage();
      console.log(`[Infinity] Tab activated: ${tabId}`);
    } catch (error) {
      console.error(`[Infinity] Error handling tab activation: ${tabId}`, error);
    }
  }

  /**
   * Handle tab removal
   */
  async handleTabRemoved(tabId) {
    try {
      if (this.storage.tabStates[tabId]) {
        const windowId = this.storage.tabStates[tabId].windowId;

        // Remove from tab states
        delete this.storage.tabStates[tabId];

        // Remove from window state
        if (this.storage.windowStates[windowId]) {
          const windowState = this.storage.windowStates[windowId];
          windowState.tabs = windowState.tabs.filter((id) => id !== tabId);

          // Clean up window if no more tabs
          if (windowState.tabs.length === 0) {
            delete this.storage.windowStates[windowId];
          }
        }

        await this.saveStorage();
        console.log(`[Infinity] Tab removed: ${tabId}`);
      }
    } catch (error) {
      console.error(`[Infinity] Error handling tab removal: ${tabId}`, error);
    }
  }

  /**
   * Handle tab update (navigation, title change, etc)
   */
  async handleTabUpdated(tabId, changeInfo, tab) {
    try {
      if (!this.storage.tabStates[tabId]) {
        this.initializeTabState(tab);
      }

      const tabState = this.storage.tabStates[tabId];

      // Update from changeInfo
      if (changeInfo.url) {
        tabState.originalUrl = changeInfo.url;
      }
      if (changeInfo.title) {
        tabState.title = changeInfo.title;
      }

      // Update favicon if available
      if (changeInfo.favIconUrl) {
        tabState.favicon = changeInfo.favIconUrl;
      }

      // Proactively capture a preview when a tab finishes loading and is active.
      // This ensures we have a preview ready before the tab is suspended.
      if (changeInfo.status === 'complete' && tab.active &&
          tab.url && !tab.url.startsWith('chrome-extension://')) {
        this.captureActiveTabPreview(tabId, tab.windowId);
      }

      await this.saveStorage();
    } catch (error) {
      console.error(`[Infinity] Error handling tab update: ${tabId}`, error);
    }
  }

  /**
   * Capture a preview of the currently visible tab and store it for later use.
   * Runs asynchronously without blocking the caller.
   */
  async captureActiveTabPreview(tabId, windowId) {
    try {
      // Small delay to let final rendering settle
      await new Promise(r => setTimeout(r, 300));
      const preview = await chrome.tabs.captureVisibleTab(windowId, {
        format: 'jpeg',
        quality: 85,
      });
      if (preview) {
        const previewKey = `preview_${tabId}`;
        await chrome.storage.local.set({ [previewKey]: { preview, timestamp: Date.now() } });
      }
    } catch (e) {
      // captureVisibleTab may fail for restricted pages — that's fine
    }
  }

  /**
   * Handle tab creation
   */
  async handleTabCreated(tab) {
    try {
      this.initializeTabState(tab);

      if (!this.storage.windowStates[tab.windowId]) {
        await this.initializeWindowState(tab.windowId);
      }

      const windowState = this.storage.windowStates[tab.windowId];
      if (!windowState.tabs.includes(tab.id)) {
        windowState.tabs.push(tab.id);
      }

      await this.saveStorage();
      console.log(`[Infinity] Tab created: ${tab.id}`);
    } catch (error) {
      console.error('[Infinity] Error handling tab creation:', error);
    }
  }

  /**
   * Handle window focus change
   */
  async handleWindowFocusChanged(windowId) {
    try {
      // Delegate to WindowSyncManager for multi-window coordination
      const oldWindowId = this.windowSyncManager.currentFocusedWindowId;
      await this.windowSyncManager.handleActiveWindowChange(oldWindowId, windowId);

      // Also update basic state for compatibility
      if (windowId === -1) {
        // Mark all windows as inactive
        Object.values(this.storage.windowStates).forEach((ws) => {
          ws.isActive = false;
        });
      } else {
        // Mark all windows as inactive except the focused one
        Object.entries(this.storage.windowStates).forEach(([wid, ws]) => {
          ws.isActive = parseInt(wid) === windowId;
        });
      }

      await this.saveStorage();
      console.log(`[Infinity] Window focus changed: ${windowId}`);
    } catch (error) {
      console.error('[Infinity] Error handling window focus change:', error);
    }
  }

  /**
   * Initialize a tab state
   */
  initializeTabState(tab) {
    this.storage.tabStates[tab.id] = {
      tabId: tab.id,
      windowId: tab.windowId,
      state: 'awake',
      originalUrl: tab.url || '',
      title: tab.title || '',
      favicon: tab.favIconUrl || '',
      savedState: {},
      lastActive: Date.now(),
    };
  }

  /**
   * Initialize a window state
   */
  async initializeWindowState(windowId) {
    this.storage.windowStates[windowId] = {
      windowId,
      isActive: false,
      tabs: [],
    };

    try {
      const window = await chrome.windows.get(windowId, { populate: true });
      this.storage.windowStates[windowId].isActive = window.focused;
      this.storage.windowStates[windowId].tabs = window.tabs.map((t) => t.id);
    } catch (error) {
      console.error(`[Infinity] Error initializing window state: ${windowId}`, error);
    }
  }

  /**
   * Sleep a tab by navigating it to a lightweight suspended.html page.
   * This fully destroys the original page's renderer process, freeing memory.
   * Works on ANY tab — including the active tab in an unfocused window.
   * A screenshot preview is captured first and stored for the suspension page.
   */
  async sleepTab(tabId) {
    try {
      if (!this.storage.tabStates[tabId]) {
        console.warn(`[Infinity] Tab not found: ${tabId}`);
        return;
      }

      const tabState = this.storage.tabStates[tabId];
      if (tabState.state === 'sleeping') return;

      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (e) {
        delete this.storage.tabStates[tabId];
        await this.saveStorage();
        return;
      }

      // Don't suspend our own extension pages or chrome:// URLs
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        return;
      }

      // Don't suspend pinned tabs
      if (tab.pinned) {
        return;
      }

      // Don't suspend tabs that have form data the user may lose
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'checkForForms' });
        if (response && response.hasForms) {
          return;
        }
      } catch (e) {
        // Content script not available — proceed with sleep
      }

      // Capture a preview screenshot via captureVisibleTab (real screenshot).
      // This requires the tab to be the active tab in its window.
      let preview = null;
      const previewKey = `preview_${tabId}`;
      try {
        const windowId = tab.windowId;
        const isActiveTab = tab.active;

        // If the tab isn't active in its window, activate it briefly for capture
        if (!isActiveTab) {
          await chrome.tabs.update(tabId, { active: true });
          // Wait for Chrome to render the re-activated tab.
          // Background tabs may have had their renderers discarded.
          await new Promise((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };

            // Listen for the tab to finish loading (in case Chrome needs to reload it)
            const onUpdated = (updatedId, info) => {
              if (updatedId === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                setTimeout(finish, 300);
              }
            };
            chrome.tabs.onUpdated.addListener(onUpdated);

            // If already loaded, just wait for rendering
            chrome.tabs.get(tabId).then(t => {
              if (t.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                setTimeout(finish, 500);
              }
            }).catch(() => setTimeout(finish, 1000));

            // Hard cap: 2 seconds
            setTimeout(finish, 2000);
          });
        }

        // Tell the content script to scroll to the top so we capture the page start
        try {
          await chrome.tabs.sendMessage(tabId, { action: 'scrollToTop' });
          await new Promise(r => setTimeout(r, 100));
        } catch (_) { /* content script may not be available */ }

        preview = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'jpeg',
          quality: 85,
        });
      } catch (e) {
        console.warn(`[Infinity] captureVisibleTab failed for tab ${tabId}:`, e.message);
      }

      // Fall back to a previously captured preview (from proactive capture)
      if (!preview) {
        try {
          const stored = await chrome.storage.local.get(previewKey);
          if (stored[previewKey] && stored[previewKey].preview) {
            preview = stored[previewKey].preview;
            console.log(`[Infinity] Using previously captured preview for tab ${tabId}`);
          }
        } catch (_) { /* no fallback available */ }
      }

      // Store the preview in local storage keyed by tab ID
      if (preview) {
        await chrome.storage.local.set({ [previewKey]: { preview, timestamp: Date.now() } });
      }

      // Save the original URL before navigating away
      tabState.originalUrl = tab.url;
      tabState.title = tab.title || '';
      tabState.favicon = tab.favIconUrl || '';
      tabState.state = 'sleeping';

      // Navigate to the suspension page
      const suspendedUrl = chrome.runtime.getURL('suspended.html') +
        `?url=${encodeURIComponent(tab.url)}` +
        `&title=${encodeURIComponent(tab.title || '')}` +
        `&preview=${encodeURIComponent(previewKey)}`;

      await chrome.tabs.update(tabId, { url: suspendedUrl });

      await this.saveStorage();
      console.log(`[Infinity] Tab suspended: ${tabId} - ${tabState.title}`);
    } catch (error) {
      console.warn(`[Infinity] Could not suspend tab ${tabId}:`, error.message);
    }
  }

  /**
   * Discard a tab using Chrome's native tab discard API.
   * This unloads the tab from memory while keeping it in the tab strip.
   * Chrome automatically reloads it when the user clicks on it.
   * Used for non-active/background tabs where preview capture isn't needed.
   */
  async discardTab(tabId) {
    try {
      if (!this.storage.tabStates[tabId]) {
        console.warn(`[Infinity] Tab not found: ${tabId}`);
        return;
      }

      const tabState = this.storage.tabStates[tabId];
      if (tabState.state === 'sleeping' || tabState.state === 'discarded') return;

      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (e) {
        delete this.storage.tabStates[tabId];
        await this.saveStorage();
        return;
      }

      // Don't discard extension pages or chrome:// URLs
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        return;
      }

      // Don't discard pinned tabs
      if (tab.pinned) {
        return;
      }

      // Don't discard the active tab (Chrome doesn't allow it anyway)
      if (tab.active) {
        return;
      }

      // Don't discard tabs already natively discarded by Chrome
      if (tab.discarded) {
        tabState.state = 'discarded';
        await this.saveStorage();
        return;
      }

      tabState.originalUrl = tab.url;
      tabState.title = tab.title || '';
      tabState.favicon = tab.favIconUrl || '';
      tabState.state = 'discarded';

      await chrome.tabs.discard(tabId);

      await this.saveStorage();
      console.log(`[Infinity] Tab discarded (native): ${tabId} - ${tabState.title}`);
    } catch (error) {
      console.warn(`[Infinity] Could not discard tab ${tabId}:`, error.message);
    }
  }

  /**
   * Wake a tab — navigate it back to its original URL.
   * Also called automatically by the suspended page itself on visibility change.
   */
  async wakeTab(tabId) {
    try {
      if (!this.storage.tabStates[tabId]) {
        console.warn(`[Infinity] Tab not found: ${tabId}`);
        return;
      }

      const tabState = this.storage.tabStates[tabId];
      if (tabState.state !== 'sleeping' && tabState.state !== 'discarded') return;

      const wasSleeping = tabState.state === 'sleeping';
      tabState.state = 'awake';
      tabState.lastActive = Date.now();

      // Only navigate back for custom-sleeping tabs (on suspended.html)
      // Discarded tabs are auto-reloaded by Chrome when activated
      if (wasSleeping) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url && tab.url.includes('suspended.html') && tabState.originalUrl) {
            await chrome.tabs.update(tabId, { url: tabState.originalUrl });
          }
        } catch (e) {
          delete this.storage.tabStates[tabId];
        }

        // Clean up preview from storage
        const previewKey = `preview_${tabId}`;
        await chrome.storage.local.remove([previewKey]);
      }

      await this.saveStorage();
      console.log(`[Infinity] Tab woken: ${tabId}`);
    } catch (error) {
      console.error(`[Infinity] Error waking tab: ${tabId}`, error);
    }
  }

  /**
   * Get all tabs organized by window
   */
  async getAllTabs() {
    const result = {};

    for (const [windowId, windowState] of Object.entries(this.storage.windowStates)) {
      result[windowId] = {
        windowState,
        tabs: windowState.tabs.map((tabId) => this.storage.tabStates[tabId]).filter(Boolean),
      };
    }

    return result;
  }

  /**
   * Get state of a specific tab
   */
  getTabState(tabId) {
    return this.storage.tabStates[tabId] || null;
  }

  /**
   * Capture and store tab preview using TabCapture
   * This method integrates with the tab-capture.js module
   */
  async captureAndStoreTabPreview(tabId, tabInfo) {
    try {
      // Dynamic import of TabCapture (will be available in built output)
      // Note: In production build, TabCapture is bundled with service worker
      const tabCapture = getTabCapture?.() || null;
      
      if (!tabCapture) {
        console.warn(`[Infinity] TabCapture not available for tab: ${tabId}`);
        return false;
      }

      // Capture the tab
      const preview = await tabCapture.captureTab(tabId);
      
      if (!preview) {
        console.warn(`[Infinity] Failed to capture tab: ${tabId}`);
        return false;
      }

      // Store with metadata
      const metadata = {
        title: tabInfo?.title || 'Unknown',
        url: tabInfo?.url || '',
        favicon: tabInfo?.favIconUrl || '',
      };

      const stored = await tabCapture.storePreview(tabId, preview, metadata);
      
      if (stored) {
        console.log(`[Infinity] Captured and stored preview for tab: ${tabId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[Infinity] Error capturing/storing preview for tab: ${tabId}`, error);
      return false;
    }
  }

  /**
   * Get memory estimate (rough calculation)
   */
  getMemoryEstimate() {
    let estimatedBytes = 0;

    // Estimate based on tab states
    Object.values(this.storage.tabStates).forEach((tabState) => {
      // Base tab state object: ~500 bytes
      estimatedBytes += 500;

      // URL and title: ~200 bytes average
      estimatedBytes += (tabState.originalUrl || '').length + (tabState.title || '').length;

      // Favicon: ~100 bytes
      estimatedBytes += 100;

      // Saved state: ~1KB average
      estimatedBytes += 1000;
    });

    return {
      bytes: estimatedBytes,
      kilobytes: Math.round(estimatedBytes / 1024),
      megabytes: Math.round((estimatedBytes / 1024 / 1024) * 100) / 100,
    };
  }

  /**
   * Get sleep statistics
   */
  getSleepStats() {
    const stats = {
      total: 0,
      awake: 0,
      sleeping: 0,
      discarded: 0,
      memory: this.getMemoryEstimate(),
      tabs: [],
    };

    Object.entries(this.storage.tabStates).forEach(([tabId, tabState]) => {
      stats.total++;
      if (tabState.state === 'awake') {
        stats.awake++;
      } else if (tabState.state === 'discarded') {
        stats.discarded++;
      } else {
        stats.sleeping++;
      }

      stats.tabs.push({
        id: tabId,
        title: tabState.title,
        state: tabState.state,
        url: tabState.originalUrl,
      });
    });

    return stats;
  }

  /**
   * Handle message: capturePreview
   */
  async handleCapturePreview(message, sender, sendResponse) {
    try {
      const { tabId, preview } = message;
      const previewKey = `preview_${tabId}`;
      await chrome.storage.local.set({ [previewKey]: { preview, timestamp: Date.now() } });
      sendResponse({ success: true });
    } catch (error) {
      console.error('[Infinity] Error handling capturePreview:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: saveTabs
   */
  async handleSaveTabs(message, sender, sendResponse) {
    try {
      const { tabIds } = message;
      for (const tabId of tabIds) {
        await this.sleepTab(tabId);
      }
      sendResponse({ success: true });
    } catch (error) {
      console.error('[Infinity] Error handling saveTabs:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: restoreTabs
   */
  async handleRestoreTabs(message, sender, sendResponse) {
    try {
      const { tabIds } = message;
      for (const tabId of tabIds) {
        await this.wakeTab(tabId);
      }
      sendResponse({ success: true });
    } catch (error) {
      console.error('[Infinity] Error handling restoreTabs:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: reportMemory
   */
  async handleReportMemory(message, sender, sendResponse) {
    try {
      const memory = this.getMemoryEstimate();
      sendResponse({ success: true, memory });
    } catch (error) {
      console.error('[Infinity] Error handling reportMemory:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: getSleepStats
   */
  async handleGetSleepStats(message, sender, sendResponse) {
    try {
      const stats = this.getSleepStats();
      sendResponse({ success: true, stats });
    } catch (error) {
      console.error('[Infinity] Error handling getSleepStats:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: getSleepTarget
   */
  async handleGetSleepTarget(message, sender, sendResponse) {
    try {
      const target = this.storage.preferences.memoryTarget;
      const current = this.getMemoryEstimate();
      sendResponse({ success: true, target, current });
    } catch (error) {
      console.error('[Infinity] Error handling getSleepTarget:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: captureTabPreview (from TabCapture module)
   */
  async handleCaptureTabPreviewRequest(message, sender, sendResponse) {
    try {
      const { tabId } = message;
      const tabState = this.storage.tabStates[tabId];
      
      if (!tabState) {
        sendResponse({ success: false, error: 'Tab not found' });
        return;
      }

      const result = await this.captureAndStoreTabPreview(tabId, {
        title: tabState.title,
        url: tabState.originalUrl,
        favIconUrl: tabState.favicon,
      });

      sendResponse({ success: result });
    } catch (error) {
      console.error('[Infinity] Error handling captureTabPreviewRequest:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: getPreviewStats (from TabCapture module)
   */
  async handleGetPreviewStats(message, sender, sendResponse) {
    try {
      // This will be called if TabCapture is available
      const tabCapture = getTabCapture?.() || null;
      
      if (!tabCapture) {
        sendResponse({ success: false, error: 'TabCapture not available' });
        return;
      }

      const stats = await tabCapture.getPreviewStats();
      sendResponse({ success: true, stats });
    } catch (error) {
      console.error('[Infinity] Error handling getPreviewStats:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Main message router
   */
  handleMessage(request, sender, sendResponse) {
    const handler = this.messageHandlers[request.action];

    if (!handler) {
      console.warn(`[Infinity] Unknown action: ${request.action}`);
      sendResponse({ success: false, error: `Unknown action: ${request.action}` });
      return;
    }

    handler(request, sender, sendResponse);
  }

  /**
   * Handle message: getMultiWindowSyncStatus
   */
  async handleGetMultiWindowSyncStatus(message, sender, sendResponse) {
    try {
      const status = await this.windowSyncManager.getGlobalSyncStatus();
      sendResponse({ success: true, status });
    } catch (error) {
      console.error('[Infinity] Error handling getMultiWindowSyncStatus:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: updateMultiWindowSyncConfig
   */
  async handleUpdateMultiWindowSyncConfig(message, sender, sendResponse) {
    try {
      const { config } = message;
      await this.windowSyncManager.updateSyncConfig(config);
      sendResponse({ success: true });
    } catch (error) {
      console.error('[Infinity] Error handling updateMultiWindowSyncConfig:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: getPreferences
   */
  async handleGetPreferences(message, sender, sendResponse) {
    try {
      sendResponse({ success: true, preferences: this.storage.preferences });
    } catch (error) {
      console.error('[Infinity] Error handling getPreferences:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: updatePreferences
   */
  async handleUpdatePreferences(message, sender, sendResponse) {
    try {
      const { preferences } = message;
      this.storage.preferences = { ...this.storage.preferences, ...preferences };
      await this.saveStorage();

      // Sync sleepThreshold to multi-window sync config
      if (preferences.sleepThreshold !== undefined) {
        await this.windowSyncManager.updateSyncConfig({
          sleepInactiveWindowsAfterMs: preferences.sleepThreshold,
        });
      }

      console.log('[Infinity] Preferences updated:', this.storage.preferences);
      sendResponse({ success: true, preferences: this.storage.preferences });
    } catch (error) {
      console.error('[Infinity] Error handling updatePreferences:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
}

// Initialize service worker
const manager = new ServiceWorkerManager();
manager.init();

// Expose manager for debugging (optional)
if (typeof globalThis !== 'undefined') {
  globalThis.infinityManager = manager;
}
