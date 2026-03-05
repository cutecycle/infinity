/**
 * Window Tracker Module for Infinity Chrome Extension
 * 
 * Manages tracking of Chrome windows, their focus state, and coordinates
 * with tab sleep/wake functionality for multi-window support
 */

/**
 * @typedef {Object} WindowState
 * @property {number} windowId - Chrome window ID
 * @property {string} state - 'normal' | 'minimized' | 'maximized' | 'fullscreen'
 * @property {boolean} focused - Whether window is currently focused
 * @property {string} type - 'normal' | 'popup' | 'panel' | 'devtools'
 * @property {number[]} tabIds - Array of tab IDs in this window
 * @property {number} tabCount - Count of tabs in this window
 * @property {number} lastFocused - Timestamp when window was last focused
 * @property {Object} bounds - Window position and size
 * @property {number} bounds.left - Left position in pixels
 * @property {number} bounds.top - Top position in pixels
 * @property {number} bounds.width - Width in pixels
 * @property {number} bounds.height - Height in pixels
 */

class WindowTracker {
  constructor() {
    this.windows = new Map(); // windowId -> WindowState
    this.activeWindowId = null;
    this.previousWindowId = null;
    this.isInitialized = false;
    
    this.messageHandlers = {
      getWindowState: this.handleGetWindowState.bind(this),
      getAllWindows: this.handleGetAllWindows.bind(this),
      getActiveWindow: this.handleGetActiveWindow.bind(this),
      getWindowTabs: this.handleGetWindowTabs.bind(this),
      updateWindowState: this.handleUpdateWindowState.bind(this),
    };
  }

  /**
   * Initialize window tracking - set up listeners and load window state
   */
  async initializeWindowTracking() {
    if (this.isInitialized) {
      console.warn('[WindowTracker] Already initialized');
      return;
    }

    try {
      // Load existing windows
      await this.loadAllWindows();

      // Setup event listeners
      this.setupEventListeners();

      // Setup message handlers
      this.setupMessageHandlers();

      this.isInitialized = true;
      console.log('[WindowTracker] Initialized with', this.windows.size, 'windows');
    } catch (error) {
      console.error('[WindowTracker] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Load all open windows from Chrome API
   */
  async loadAllWindows() {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      
      // Clear existing windows
      this.windows.clear();

      for (const window of windows) {
        // Skip devtools windows
        if (window.type === 'devtools') {
          continue;
        }

        const tabIds = window.tabs ? window.tabs.map(tab => tab.id) : [];
        
        const windowState = {
          windowId: window.id,
          state: window.state || 'normal',
          focused: window.focused || false,
          type: window.type || 'normal',
          tabIds: tabIds,
          tabCount: tabIds.length,
          lastFocused: window.focused ? Date.now() : 0,
          bounds: {
            left: window.left || 0,
            top: window.top || 0,
            width: window.width || 0,
            height: window.height || 0,
          },
        };

        this.windows.set(window.id, windowState);

        if (window.focused) {
          this.activeWindowId = window.id;
        }
      }

      await this.persistWindowState();
    } catch (error) {
      console.error('[WindowTracker] Failed to load windows:', error);
      throw error;
    }
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Window focus changed
    chrome.windows.onFocusChanged.addListener((windowId) => {
      this.handleWindowFocusChanged(windowId);
    });

    // Window created
    chrome.windows.onCreated.addListener((window) => {
      this.handleWindowCreated(window);
    });

    // Window removed
    chrome.windows.onRemoved.addListener((windowId) => {
      this.handleWindowRemoved(windowId);
    });

    // Tab activated (to track active tab within window)
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabActivated(activeInfo);
    });

    // Tab created (for tracking tab count)
    chrome.tabs.onCreated.addListener((tab) => {
      this.handleTabCreated(tab);
    });

    // Tab removed (for tracking tab count)
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      this.handleTabRemoved(tabId, removeInfo);
    });

    console.log('[WindowTracker] Event listeners setup');
  }

  /**
   * Setup message handlers
   */
  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      const handler = this.messageHandlers[request.action];
      if (handler) {
        handler(request, sender, sendResponse);
        return true; // Enable async response
      }
    });
  }

  /**
   * Handle window focus change
   */
  async handleWindowFocusChanged(windowId) {
    try {
      // If windowId is -1, no window is focused (switched to another app or all minimized)
      if (windowId === -1) {
        if (this.activeWindowId !== null) {
          const prevWindow = this.windows.get(this.activeWindowId);
          if (prevWindow) {
            prevWindow.focused = false;
            // Don't clear activeWindowId - maintain last known window
          }
        }
        console.log('[WindowTracker] Focus lost (possibly switched to another app)');
        return;
      }

      // Get previous active window
      const previousWindow = this.windows.get(this.activeWindowId);
      if (previousWindow) {
        previousWindow.focused = false;
        await this.handleWindowBlur(this.activeWindowId);
      }

      // Update new focused window
      const newWindow = this.windows.get(windowId);
      if (!newWindow) {
        // Window not tracked yet, initialize it
        const chromWindow = await chrome.windows.get(windowId, { populate: true });
        this.initializeWindowState(chromWindow);
      } else {
        newWindow.focused = true;
        newWindow.lastFocused = Date.now();
      }

      this.previousWindowId = this.activeWindowId;
      this.activeWindowId = windowId;

      await this.handleWindowFocus(windowId);
      await this.persistWindowState();

      console.log('[WindowTracker] Window focus changed to:', windowId);
    } catch (error) {
      console.error('[WindowTracker] Error handling window focus change:', error);
    }
  }

  /**
   * Handle window creation
   */
  async handleWindowCreated(window) {
    try {
      if (window.type === 'devtools') {
        return; // Skip devtools windows
      }

      this.initializeWindowState(window);
      await this.persistWindowState();
      console.log('[WindowTracker] Window created:', window.id);
    } catch (error) {
      console.error('[WindowTracker] Error handling window creation:', error);
    }
  }

  /**
   * Handle window removal
   */
  async handleWindowRemoved(windowId) {
    try {
      this.windows.delete(windowId);

      if (this.activeWindowId === windowId) {
        this.activeWindowId = null;
      }
      if (this.previousWindowId === windowId) {
        this.previousWindowId = null;
      }

      await this.persistWindowState();
      console.log('[WindowTracker] Window removed:', windowId);
    } catch (error) {
      console.error('[WindowTracker] Error handling window removal:', error);
    }
  }

  /**
   * Handle tab activation
   */
  async handleTabActivated(activeInfo) {
    try {
      const { windowId } = activeInfo;
      
      const windowState = this.windows.get(windowId);
      if (windowState) {
        windowState.lastFocused = Date.now();
        await this.persistWindowState();
      }
    } catch (error) {
      console.error('[WindowTracker] Error handling tab activation:', error);
    }
  }

  /**
   * Handle tab creation
   */
  async handleTabCreated(tab) {
    try {
      const windowState = this.windows.get(tab.windowId);
      if (!windowState) {
        // Window not tracked yet, initialize it
        const chromWindow = await chrome.windows.get(tab.windowId, { populate: true });
        this.initializeWindowState(chromWindow);
      } else {
        // Update tab count
        const chromWindow = await chrome.windows.get(tab.windowId, { populate: true });
        windowState.tabIds = chromWindow.tabs.map(t => t.id);
        windowState.tabCount = windowState.tabIds.length;
        await this.persistWindowState();
      }
    } catch (error) {
      console.error('[WindowTracker] Error handling tab creation:', error);
    }
  }

  /**
   * Handle tab removal
   */
  async handleTabRemoved(tabId, removeInfo) {
    try {
      const { windowId } = removeInfo;
      const windowState = this.windows.get(windowId);
      
      if (windowState) {
        // Remove tab from tracking
        windowState.tabIds = windowState.tabIds.filter(id => id !== tabId);
        windowState.tabCount = windowState.tabIds.length;

        // If window has no more tabs, it may be closing
        await this.persistWindowState();
      }
    } catch (error) {
      console.error('[WindowTracker] Error handling tab removal:', error);
    }
  }

  /**
   * Initialize window state from Chrome window object
   */
  initializeWindowState(chromWindow) {
    if (chromWindow.type === 'devtools') {
      return;
    }

    const tabIds = chromWindow.tabs ? chromWindow.tabs.map(tab => tab.id) : [];
    
    const windowState = {
      windowId: chromWindow.id,
      state: chromWindow.state || 'normal',
      focused: chromWindow.focused || false,
      type: chromWindow.type || 'normal',
      tabIds: tabIds,
      tabCount: tabIds.length,
      lastFocused: chromWindow.focused ? Date.now() : 0,
      bounds: {
        left: chromWindow.left || 0,
        top: chromWindow.top || 0,
        width: chromWindow.width || 0,
        height: chromWindow.height || 0,
      },
    };

    this.windows.set(chromWindow.id, windowState);
    return windowState;
  }

  /**
   * Called when a window gains focus
   */
  async handleWindowFocus(windowId) {
    try {
      console.log('[WindowTracker] Window gained focus:', windowId);
      // Hook point for sleep/wake coordination
      // Emit event or call service worker to wake tabs in this window
    } catch (error) {
      console.error('[WindowTracker] Error in window focus handler:', error);
    }
  }

  /**
   * Called when a window loses focus
   */
  async handleWindowBlur(windowId) {
    try {
      console.log('[WindowTracker] Window lost focus:', windowId);
      // Hook point for sleep/wake coordination
      // Emit event or call service worker to sleep tabs in this window
    } catch (error) {
      console.error('[WindowTracker] Error in window blur handler:', error);
    }
  }

  /**
   * Get the currently focused window
   */
  async getActiveWindow() {
    try {
      if (this.activeWindowId === null) {
        return null;
      }

      const windowState = this.windows.get(this.activeWindowId);
      if (!windowState) {
        return null;
      }

      // Get fresh data from Chrome API
      const chromWindow = await chrome.windows.get(this.activeWindowId, { populate: true });
      return this.createWindowResponse(windowState, chromWindow);
    } catch (error) {
      console.error('[WindowTracker] Error getting active window:', error);
      return null;
    }
  }

  /**
   * Get all tabs in a specific window
   */
  async getWindowTabs(windowId) {
    try {
      const windowState = this.windows.get(windowId);
      if (!windowState) {
        console.warn('[WindowTracker] Window not found:', windowId);
        return [];
      }

      const chromWindow = await chrome.windows.get(windowId, { populate: true });
      return chromWindow.tabs || [];
    } catch (error) {
      console.error('[WindowTracker] Error getting window tabs:', error);
      return [];
    }
  }

  /**
   * Get detailed window info
   */
  async getWindowState(windowId) {
    try {
      const windowState = this.windows.get(windowId);
      if (!windowState) {
        console.warn('[WindowTracker] Window not found:', windowId);
        return null;
      }

      // Get fresh data from Chrome API
      const chromWindow = await chrome.windows.get(windowId, { populate: true });
      return this.createWindowResponse(windowState, chromWindow);
    } catch (error) {
      console.error('[WindowTracker] Error getting window state:', error);
      return null;
    }
  }

  /**
   * Get list of all open windows
   */
  async getAllWindows() {
    try {
      const windowList = [];

      for (const [windowId, windowState] of this.windows.entries()) {
        try {
          const chromWindow = await chrome.windows.get(windowId, { populate: true });
          windowList.push(this.createWindowResponse(windowState, chromWindow));
        } catch (error) {
          console.warn('[WindowTracker] Error fetching window:', windowId, error);
          // Window may have been closed, skip it
        }
      }

      // Sort by last focused (most recent first)
      windowList.sort((a, b) => b.lastFocused - a.lastFocused);
      return windowList;
    } catch (error) {
      console.error('[WindowTracker] Error getting all windows:', error);
      return [];
    }
  }

  /**
   * Update window metadata
   */
  async updateWindowState(windowId, changes) {
    try {
      const windowState = this.windows.get(windowId);
      if (!windowState) {
        console.warn('[WindowTracker] Window not found:', windowId);
        return null;
      }

      // Update allowed fields
      if (changes.state !== undefined) {
        windowState.state = changes.state;
      }
      if (changes.bounds !== undefined) {
        windowState.bounds = { ...windowState.bounds, ...changes.bounds };
      }
      if (changes.focused !== undefined) {
        windowState.focused = changes.focused;
      }
      if (changes.lastFocused !== undefined) {
        windowState.lastFocused = changes.lastFocused;
      }

      await this.persistWindowState();
      return windowState;
    } catch (error) {
      console.error('[WindowTracker] Error updating window state:', error);
      return null;
    }
  }

  /**
   * Create a complete window response from state and Chrome API data
   */
  createWindowResponse(windowState, chromWindow) {
    const tabs = chromWindow.tabs || [];
    
    return {
      windowId: windowState.windowId,
      state: windowState.state,
      focused: windowState.focused,
      type: windowState.type,
      tabIds: tabs.map(tab => tab.id),
      tabCount: tabs.length,
      lastFocused: windowState.lastFocused,
      bounds: windowState.bounds,
      tabs: tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        active: tab.active,
      })),
      isActive: this.activeWindowId === windowState.windowId,
    };
  }

  /**
   * Persist window state to storage
   */
  async persistWindowState() {
    try {
      const windowsArray = Array.from(this.windows.values());
      const data = {
        windows: windowsArray,
        activeWindowId: this.activeWindowId,
        previousWindowId: this.previousWindowId,
        timestamp: Date.now(),
      };

      await chrome.storage.local.set({ windowTrackerState: data });
    } catch (error) {
      console.error('[WindowTracker] Error persisting window state:', error);
    }
  }

  /**
   * Restore window state from storage
   */
  async restoreWindowState() {
    try {
      const result = await chrome.storage.local.get(['windowTrackerState']);
      if (result.windowTrackerState) {
        const data = result.windowTrackerState;
        this.windows.clear();
        data.windows.forEach(windowState => {
          this.windows.set(windowState.windowId, windowState);
        });
        this.activeWindowId = data.activeWindowId;
        this.previousWindowId = data.previousWindowId;
        console.log('[WindowTracker] Restored window state:', this.windows.size, 'windows');
      }
    } catch (error) {
      console.error('[WindowTracker] Error restoring window state:', error);
    }
  }

  /**
   * Get window focus history (for tracking multi-window scenarios)
   */
  getWindowFocusHistory() {
    const history = [];
    
    const sorted = Array.from(this.windows.values())
      .sort((a, b) => b.lastFocused - a.lastFocused);

    sorted.forEach(windowState => {
      history.push({
        windowId: windowState.windowId,
        lastFocused: windowState.lastFocused,
        tabCount: windowState.tabCount,
        type: windowState.type,
      });
    });

    return history;
  }

  /**
   * Check if window is currently focused
   */
  isWindowFocused(windowId) {
    return this.activeWindowId === windowId;
  }

  /**
   * Get the previous active window
   */
  getPreviousWindow() {
    if (this.previousWindowId === null) {
      return null;
    }

    return this.windows.get(this.previousWindowId) || null;
  }

  /**
   * Handle message: getWindowState
   */
  async handleGetWindowState(request, sender, sendResponse) {
    try {
      const { windowId } = request;
      const state = await this.getWindowState(windowId);
      sendResponse({ success: true, windowState: state });
    } catch (error) {
      console.error('[WindowTracker] Error handling getWindowState:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: getAllWindows
   */
  async handleGetAllWindows(request, sender, sendResponse) {
    try {
      const windows = await this.getAllWindows();
      sendResponse({ success: true, windows });
    } catch (error) {
      console.error('[WindowTracker] Error handling getAllWindows:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: getActiveWindow
   */
  async handleGetActiveWindow(request, sender, sendResponse) {
    try {
      const window = await this.getActiveWindow();
      sendResponse({ success: true, window });
    } catch (error) {
      console.error('[WindowTracker] Error handling getActiveWindow:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: getWindowTabs
   */
  async handleGetWindowTabs(request, sender, sendResponse) {
    try {
      const { windowId } = request;
      const tabs = await this.getWindowTabs(windowId);
      sendResponse({ success: true, tabs });
    } catch (error) {
      console.error('[WindowTracker] Error handling getWindowTabs:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle message: updateWindowState
   */
  async handleUpdateWindowState(request, sender, sendResponse) {
    try {
      const { windowId, changes } = request;
      const state = await this.updateWindowState(windowId, changes);
      sendResponse({ success: true, windowState: state });
    } catch (error) {
      console.error('[WindowTracker] Error handling updateWindowState:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
}

// Export for use in service worker
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WindowTracker;
}
