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
 * @property {'awake'|'sleeping'} state - Current state
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
        sleepThreshold: 300000, // 5 minutes
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
    await this.windowSyncManager.initializeSync();
    console.log('[Infinity] Service Worker initialized');
  }

  /**
   * Discover all existing tabs/windows and populate state
   */
  async discoverExistingTabs() {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      for (const win of windows) {
        if (win.type !== 'normal') continue;

        this.storage.windowStates[win.id] = {
          windowId: win.id,
          isActive: win.focused,
          tabs: win.tabs.map(t => t.id),
        };

        for (const tab of win.tabs) {
          if (!this.storage.tabStates[tab.id]) {
            this.initializeTabState(tab);
          }
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
    }
  }

  /**
   * Setup all event listeners
   */
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
      tabState.state = 'awake';

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

      await this.saveStorage();
    } catch (error) {
      console.error(`[Infinity] Error handling tab update: ${tabId}`, error);
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
      preview: null,
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
   * Sleep a tab using chrome.tabs.discard() for reliable memory reclamation.
   * This is the same mechanism Chrome mobile uses to handle thousands of tabs.
   * The tab stays in the tab strip but its renderer process is killed.
   * Chrome natively preserves the tab's title, favicon, and thumbnail for alt-tab.
   */
  async sleepTab(tabId) {
    try {
      if (!this.storage.tabStates[tabId]) {
        console.warn(`[Infinity] Tab not found: ${tabId}`);
        return;
      }

      const tabState = this.storage.tabStates[tabId];

      // Don't re-sleep already sleeping tabs
      if (tabState.state === 'sleeping') return;

      // Don't discard the active tab in the focused window
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.active) {
          console.log(`[Infinity] Skipping active tab: ${tabId}`);
          return;
        }
        if (tab.discarded) {
          tabState.state = 'sleeping';
          await this.saveStorage();
          return;
        }
      } catch (e) {
        // Tab may have been closed
        delete this.storage.tabStates[tabId];
        await this.saveStorage();
        return;
      }

      // Use Chrome's native tab discard — kills the renderer process,
      // reclaims memory, but preserves the tab entry and its thumbnail.
      await chrome.tabs.discard(tabId);

      tabState.state = 'sleeping';
      await this.saveStorage();
      console.log(`[Infinity] Tab discarded (sleeping): ${tabId} - ${tabState.title}`);
    } catch (error) {
      // chrome.tabs.discard throws if tab can't be discarded (e.g. active tab, playing audio)
      console.warn(`[Infinity] Could not discard tab ${tabId}:`, error.message);
    }
  }

  /**
   * Wake a tab — Chrome handles this automatically when the user clicks on a
   * discarded tab. We just update our internal state.
   * If we want to proactively wake, we reload the tab.
   */
  async wakeTab(tabId) {
    try {
      if (!this.storage.tabStates[tabId]) {
        console.warn(`[Infinity] Tab not found: ${tabId}`);
        return;
      }

      const tabState = this.storage.tabStates[tabId];
      if (tabState.state !== 'sleeping') return;

      tabState.state = 'awake';
      tabState.lastActive = Date.now();

      // Check if tab is still discarded; if so, reload it
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.discarded) {
          await chrome.tabs.reload(tabId);
        }
      } catch (e) {
        // Tab may have been closed
        delete this.storage.tabStates[tabId];
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
   * Update tab preview
   */
  async updateTabPreview(tabId, previewBase64) {
    try {
      if (!this.storage.tabStates[tabId]) {
        console.warn(`[Infinity] Tab not found: ${tabId}`);
        return;
      }

      this.storage.tabStates[tabId].preview = previewBase64;
      await this.saveStorage();
      console.log(`[Infinity] Preview updated for tab: ${tabId}`);
    } catch (error) {
      console.error(`[Infinity] Error updating tab preview: ${tabId}`, error);
    }
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
        // Also store in tab state for quick access
        await this.updateTabPreview(tabId, preview);
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

      // Preview: estimate base64 size (roughly 4/3 of actual image)
      if (tabState.preview) {
        // Most previews are ~50-100KB
        estimatedBytes += Math.min(100000, tabState.preview.length);
      }

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
      memory: this.getMemoryEstimate(),
      tabs: [],
    };

    Object.entries(this.storage.tabStates).forEach(([tabId, tabState]) => {
      stats.total++;
      if (tabState.state === 'awake') {
        stats.awake++;
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
      await this.updateTabPreview(tabId, preview);
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
}

// Initialize service worker
const manager = new ServiceWorkerManager();
manager.init();

// Expose manager for debugging (optional)
if (typeof globalThis !== 'undefined') {
  globalThis.infinityManager = manager;
}
