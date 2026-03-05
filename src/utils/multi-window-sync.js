/**
 * Multi-Window Synchronization Manager for Infinity Chrome Extension
 * Coordinates tab sleep/wake across multiple windows based on focus state
 * 
 * Architecture:
 * ServiceWorkerManager (core state) ← WindowSyncManager (coordination) → TabSleep/TabWake
 * WindowTracker (focus detection) → WindowSyncManager
 */

import { saveToStorage, getFromStorage, log } from '../utils.js';

/**
 * @typedef {Object} SyncConfig
 * @property {boolean} enableMultiWindowSync - Master control flag
 * @property {number} sleepInactiveWindowsAfterMs - Delay before sleeping other windows (0 = immediate)
 * @property {boolean} allowPinnedTabsToStayAwake - Always true for now
 * @property {string[]} whitelist - URLs that never sleep
 */

class WindowSyncManager {
  constructor(serviceWorkerManager) {
    this.swManager = serviceWorkerManager;
    this.syncConfig = {
      enableMultiWindowSync: true,
      sleepInactiveWindowsAfterMs: 0,
      allowPinnedTabsToStayAwake: true,
      whitelist: [],
    };
    
    // Track current focus state
    this.currentFocusedWindowId = null;
    this.previousFocusedWindowId = null;
    
    // Debounce rapid window switches
    this.windowSwitchTimeout = null;
    this.pendingOperations = new Map(); // windowId -> operation queue
    this.operationInProgress = new Set(); // windowIds with ongoing operations
    
    // Non-sleepable URL patterns
    this.unsleepablePatterns = [
      /^chrome:\/\//,
      /^about:/,
      /^chrome-extension:\/\//,
    ];
  }

  /**
   * Initialize synchronization
   */
  async initializeSync() {
    try {
      log('WindowSyncManager: Initializing multi-window sync', {});
      
      // Load configuration from storage
      await this.loadSyncConfig();
      
      // Get initial window focus state from Chrome
      const focusedWindow = await this.getWindowFocusState();
      if (focusedWindow && focusedWindow.id !== -1) {
        this.currentFocusedWindowId = focusedWindow.id;
      }
      
      // Initialize all windows
      const allWindows = await this.getAllWindowsWithTabs();
      for (const window of allWindows) {
        if (!this.swManager.storage.windowStates[window.id]) {
          await this.swManager.initializeWindowState(window.id);
        }
      }
      
      log('WindowSyncManager: Initialized', { 
        focusedWindowId: this.currentFocusedWindowId,
        totalWindows: allWindows.length,
      });
    } catch (error) {
      console.error('[WindowSyncManager] Error initializing sync:', error);
    }
  }

  /**
   * Load synchronization configuration from storage
   */
  async loadSyncConfig() {
    try {
      const stored = await getFromStorage('multiWindowSyncConfig');
      if (stored) {
        this.syncConfig = { ...this.syncConfig, ...stored };
      }
      
      // Also load whitelist from preferences if available
      const prefs = await getFromStorage('preferences');
      if (prefs && prefs.whitelist) {
        this.syncConfig.whitelist = prefs.whitelist;
      }
    } catch (error) {
      console.warn('[WindowSyncManager] Error loading sync config:', error);
    }
  }

  /**
   * Save synchronization configuration to storage
   */
  async saveSyncConfig() {
    try {
      await saveToStorage('multiWindowSyncConfig', this.syncConfig);
      log('WindowSyncManager: Sync config saved', this.syncConfig);
    } catch (error) {
      console.error('[WindowSyncManager] Error saving sync config:', error);
    }
  }

  /**
   * Main handler for active window change
   * Orchestrates sleeping tabs in non-focused windows and waking tabs in focused window
   */
  async handleActiveWindowChange(oldWindowId, newWindowId) {
    try {
      if (!this.syncConfig.enableMultiWindowSync) {
        log('WindowSyncManager: Multi-window sync disabled', {});
        return;
      }

      log('WindowSyncManager: Window focus change', { 
        oldWindowId, 
        newWindowId,
      });

      // Handle case where focus moved away from Chrome
      if (newWindowId === -1) {
        log('WindowSyncManager: Chrome lost focus', {});
        this.previousFocusedWindowId = this.currentFocusedWindowId;
        return;
      }

      this.previousFocusedWindowId = this.currentFocusedWindowId;
      this.currentFocusedWindowId = newWindowId;

      // Debounce rapid window switches
      if (this.windowSwitchTimeout) {
        clearTimeout(this.windowSwitchTimeout);
      }

      this.windowSwitchTimeout = setTimeout(async () => {
        try {
          // Wake tabs in newly focused window
          if (newWindowId !== -1) {
            await this.wakeWindowTabs(newWindowId);
          }

          // Sleep tabs in previously focused window(s)
          if (oldWindowId && oldWindowId !== -1) {
            await this.sleepWindowTabs(oldWindowId, {
              pinned: true,
              whitelisted: true,
            });
          } else if (this.previousFocusedWindowId && this.previousFocusedWindowId !== -1) {
            await this.sleepWindowTabs(this.previousFocusedWindowId, {
              pinned: true,
              whitelisted: true,
            });
          }

          // Sleep tabs in all other inactive windows
          const allWindows = await this.getAllWindowsWithTabs();
          for (const window of allWindows) {
            if (window.id !== newWindowId && window.focused === false) {
              await this.sleepWindowTabs(window.id, {
                pinned: true,
                whitelisted: true,
              });
            }
          }

          // Report state changes to UI
          await this.broadcastStateChanges();
        } catch (error) {
          console.error('[WindowSyncManager] Error handling window switch:', error);
        }
      }, this.syncConfig.sleepInactiveWindowsAfterMs);
    } catch (error) {
      console.error('[WindowSyncManager] Error in handleActiveWindowChange:', error);
    }
  }

  /**
   * Sleep all tabs in a window except whitelisted ones
   */
  async sleepWindowTabs(windowId, exceptions = {}) {
    try {
      // Skip if operation already in progress
      if (this.operationInProgress.has(windowId)) {
        log('WindowSyncManager: Sleep operation already in progress', { windowId });
        return;
      }

      this.operationInProgress.add(windowId);
      log('WindowSyncManager: Sleeping window tabs', { windowId, exceptions });

      const tabs = await this.getWindowTabs(windowId);
      const tabsToSleep = [];

      for (const tab of tabs) {
        // Check if tab should be skipped
        if (this.shouldSkipTab(tab, exceptions)) {
          log('WindowSyncManager: Skipping tab (exception)', { 
            tabId: tab.id, 
            title: tab.title,
            reason: this.getSkipReason(tab, exceptions),
          });
          continue;
        }

        tabsToSleep.push(tab.id);
      }

      // Batch sleep operations
      if (tabsToSleep.length > 0) {
        log('WindowSyncManager: Batching sleep for tabs', { 
          windowId, 
          count: tabsToSleep.length,
        });

        // Execute sleep operations
        for (const tabId of tabsToSleep) {
          try {
            await this.swManager.sleepTab(tabId);
          } catch (error) {
            console.warn(`[WindowSyncManager] Error sleeping tab ${tabId}:`, error);
          }
        }

        // Update window state
        if (this.swManager.storage.windowStates[windowId]) {
          this.swManager.storage.windowStates[windowId].isActive = false;
          await this.swManager.saveStorage();
        }
      }

      this.operationInProgress.delete(windowId);
    } catch (error) {
      console.error('[WindowSyncManager] Error sleeping window tabs:', error);
      this.operationInProgress.delete(windowId);
    }
  }

  /**
   * Wake all tabs in a window
   */
  async wakeWindowTabs(windowId) {
    try {
      // Skip if operation already in progress
      if (this.operationInProgress.has(windowId)) {
        log('WindowSyncManager: Wake operation already in progress', { windowId });
        return;
      }

      this.operationInProgress.add(windowId);
      log('WindowSyncManager: Waking window tabs', { windowId });

      const tabs = await this.getWindowTabs(windowId);
      const tabsToWake = [];

      for (const tab of tabs) {
        const tabState = this.swManager.storage.tabStates[tab.id];
        if (tabState && tabState.state === 'sleeping') {
          tabsToWake.push(tab.id);
        }
      }

      // Batch wake operations
      if (tabsToWake.length > 0) {
        log('WindowSyncManager: Batching wake for tabs', { 
          windowId, 
          count: tabsToWake.length,
        });

        // Execute wake operations
        for (const tabId of tabsToWake) {
          try {
            await this.swManager.wakeTab(tabId);
          } catch (error) {
            console.warn(`[WindowSyncManager] Error waking tab ${tabId}:`, error);
          }
        }

        // Update window state
        if (this.swManager.storage.windowStates[windowId]) {
          this.swManager.storage.windowStates[windowId].isActive = true;
          await this.swManager.saveStorage();
        }
      }

      this.operationInProgress.delete(windowId);
    } catch (error) {
      console.error('[WindowSyncManager] Error waking window tabs:', error);
      this.operationInProgress.delete(windowId);
    }
  }

  /**
   * Get sleep status for all tabs in a window
   */
  async getWindowSyncStatus(windowId) {
    try {
      const tabs = await this.getWindowTabs(windowId);
      const windowState = this.swManager.storage.windowStates[windowId];

      const status = {
        windowId,
        isActive: windowState ? windowState.isActive : false,
        tabs: [],
        summary: {
          total: tabs.length,
          awake: 0,
          sleeping: 0,
          skipped: 0,
        },
      };

      for (const tab of tabs) {
        const tabState = this.swManager.storage.tabStates[tab.id];
        const reason = this.getSkipReason(tab, { pinned: true, whitelisted: true });

        const tabInfo = {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          pinned: tab.pinned,
          state: tabState ? tabState.state : 'unknown',
          skipped: !!reason,
          skipReason: reason,
        };

        status.tabs.push(tabInfo);

        if (reason) {
          status.summary.skipped++;
        } else if (tabState && tabState.state === 'awake') {
          status.summary.awake++;
        } else if (tabState && tabState.state === 'sleeping') {
          status.summary.sleeping++;
        }
      }

      return status;
    } catch (error) {
      console.error('[WindowSyncManager] Error getting window sync status:', error);
      return null;
    }
  }

  /**
   * Get synchronization status across all windows
   */
  async getGlobalSyncStatus() {
    try {
      const allWindows = await this.getAllWindowsWithTabs();
      const status = {
        config: this.syncConfig,
        currentFocusedWindowId: this.currentFocusedWindowId,
        windows: [],
        summary: {
          totalWindows: allWindows.length,
          focusedWindows: 0,
          unfocusedWindows: 0,
          totalTabs: 0,
          awakeTabs: 0,
          sleepingTabs: 0,
          skippedTabs: 0,
        },
      };

      for (const window of allWindows) {
        const windowStatus = await this.getWindowSyncStatus(window.id);
        if (windowStatus) {
          status.windows.push(windowStatus);
          
          status.summary.totalTabs += windowStatus.summary.total;
          status.summary.awakeTabs += windowStatus.summary.awake;
          status.summary.sleepingTabs += windowStatus.summary.sleeping;
          status.summary.skippedTabs += windowStatus.summary.skipped;

          if (window.focused) {
            status.summary.focusedWindows++;
          } else {
            status.summary.unfocusedWindows++;
          }
        }
      }

      return status;
    } catch (error) {
      console.error('[WindowSyncManager] Error getting global sync status:', error);
      return null;
    }
  }

  /**
   * Check if a tab should be skipped (not slept)
   */
  shouldSkipTab(tab, exceptions = {}) {
    // Skip if unsleepable URL
    if (this.isUnsleepableUrl(tab.url)) {
      return true;
    }

    // Skip if pinned and exception allows
    if (exceptions.pinned && tab.pinned) {
      return true;
    }

    // Skip if whitelisted and exception allows
    if (exceptions.whitelisted && this.isWhitelistedUrl(tab.url)) {
      return true;
    }

    return false;
  }

  /**
   * Get reason why a tab is skipped
   */
  getSkipReason(tab, exceptions = {}) {
    if (this.isUnsleepableUrl(tab.url)) {
      return 'unsleepable_url';
    }

    if (exceptions.pinned && tab.pinned) {
      return 'pinned_tab';
    }

    if (exceptions.whitelisted && this.isWhitelistedUrl(tab.url)) {
      return 'whitelisted_url';
    }

    return null;
  }

  /**
   * Check if URL is unsleepable (chrome://, about:*, chrome-extension://)
   */
  isUnsleepableUrl(url) {
    if (!url) return true;
    
    for (const pattern of this.unsleepablePatterns) {
      if (pattern.test(url)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if URL is whitelisted
   */
  isWhitelistedUrl(url) {
    if (!url || !this.syncConfig.whitelist || this.syncConfig.whitelist.length === 0) {
      return false;
    }

    for (const whitelistEntry of this.syncConfig.whitelist) {
      try {
        // Handle both domain and full URL patterns
        if (url.includes(whitelistEntry)) {
          return true;
        }
        
        // Try as regex pattern
        const regex = new RegExp(whitelistEntry);
        if (regex.test(url)) {
          return true;
        }
      } catch (error) {
        // Skip invalid regex patterns
        continue;
      }
    }

    return false;
  }

  /**
   * Broadcast state changes to popup UI
   */
  async broadcastStateChanges() {
    try {
      const status = await this.getGlobalSyncStatus();
      
      // Send to all popup instances
      chrome.runtime.sendMessage({
        action: 'multiWindowSyncStatusUpdate',
        status,
      }).catch(() => {
        // No popup listening, ignore error
      });

      log('WindowSyncManager: Broadcasted state changes', {
        awakeTabs: status.summary.awakeTabs,
        sleepingTabs: status.summary.sleepingTabs,
      });
    } catch (error) {
      console.warn('[WindowSyncManager] Error broadcasting state changes:', error);
    }
  }

  /**
   * Get all windows with their tabs
   */
  async getAllWindowsWithTabs() {
    return new Promise((resolve) => {
      chrome.windows.getAll({ populate: true }, (windows) => {
        resolve(windows || []);
      });
    });
  }

  /**
   * Get all tabs in a specific window
   */
  async getWindowTabs(windowId) {
    return new Promise((resolve) => {
      chrome.tabs.query({ windowId }, (tabs) => {
        resolve(tabs || []);
      });
    });
  }

  /**
   * Get current window focus state
   */
  async getWindowFocusState() {
    return new Promise((resolve) => {
      chrome.windows.getLastFocused((window) => {
        resolve(window || { id: -1 });
      });
    });
  }

  /**
   * Update multi-window sync configuration
   */
  async updateSyncConfig(newConfig) {
    try {
      this.syncConfig = { ...this.syncConfig, ...newConfig };
      await this.saveSyncConfig();
      
      log('WindowSyncManager: Config updated', this.syncConfig);
      
      // Re-broadcast status after config change
      await this.broadcastStateChanges();
    } catch (error) {
      console.error('[WindowSyncManager] Error updating sync config:', error);
    }
  }

  /**
   * Add URL to whitelist
   */
  async addToWhitelist(url) {
    try {
      if (!this.syncConfig.whitelist.includes(url)) {
        this.syncConfig.whitelist.push(url);
        await this.saveSyncConfig();
        log('WindowSyncManager: URL added to whitelist', { url });
      }
    } catch (error) {
      console.error('[WindowSyncManager] Error adding to whitelist:', error);
    }
  }

  /**
   * Remove URL from whitelist
   */
  async removeFromWhitelist(url) {
    try {
      this.syncConfig.whitelist = this.syncConfig.whitelist.filter(u => u !== url);
      await this.saveSyncConfig();
      log('WindowSyncManager: URL removed from whitelist', { url });
    } catch (error) {
      console.error('[WindowSyncManager] Error removing from whitelist:', error);
    }
  }

  /**
   * Handle tab moved to different window
   */
  async handleTabMovedBetweenWindows(tabId, oldWindowId, newWindowId) {
    try {
      log('WindowSyncManager: Tab moved between windows', { 
        tabId, 
        oldWindowId, 
        newWindowId,
      });

      // Re-evaluate sync state for the tab
      const tab = await this.getTabInfo(tabId);
      if (!tab) return;

      const tabState = this.swManager.storage.tabStates[tabId];
      const newWindowState = this.swManager.storage.windowStates[newWindowId];

      // If tab is now in focused window, wake it
      if (newWindowId === this.currentFocusedWindowId && tabState && tabState.state === 'sleeping') {
        await this.swManager.wakeTab(tabId);
      }
      // If tab is now in unfocused window, sleep it (unless exception)
      else if (newWindowId !== this.currentFocusedWindowId && !this.shouldSkipTab(tab)) {
        await this.swManager.sleepTab(tabId);
      }

      await this.broadcastStateChanges();
    } catch (error) {
      console.error('[WindowSyncManager] Error handling tab moved:', error);
    }
  }

  /**
   * Get tab information
   */
  async getTabInfo(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(tab || null);
        }
      });
    });
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.windowSwitchTimeout) {
      clearTimeout(this.windowSwitchTimeout);
    }
    this.pendingOperations.clear();
    this.operationInProgress.clear();
    log('WindowSyncManager: Cleaned up resources', {});
  }
}

export default WindowSyncManager;
