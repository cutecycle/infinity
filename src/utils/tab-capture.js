/**
 * Tab Capture Module for Infinity Chrome Extension
 * 
 * Manages screenshot capture and compression for alt-tab previews
 * 
 * Capture Strategy:
 * - Option C (Implemented): Content script canvas capture via messaging
 *   - Works with existing tab-sleep architecture
 *   - No special permissions required
 *   - Reliable fallback mechanism
 * 
 * - Option A (Future): chrome.tabs.captureVisibleTab()
 *   - Requires activeTab permission
 *   - Higher quality captures
 *   - Only works with active tabs
 *   - Chrome 88+ supported
 * 
 * - Option B (Future): Offscreen API (Chrome 109+)
 *   - Background rendering without visual display
 *   - Can capture non-active tabs
 *   - Best for performance
 *   - Requires offscreen permission
 */

const STORAGE_PREFIX = 'infinity-preview';
const MAX_PREVIEW_SIZE = 2097152; // 2 MB per preview (full-page screenshots)
const PREVIEW_WIDTH = 1920;
const PREVIEW_HEIGHT = 0; // unused — full page height is preserved
const CLEANUP_BATCH_SIZE = 10; // Clean up multiple previews at once
const STORAGE_QUOTA_CHECK_INTERVAL = 60000; // Check quota every 60 seconds

class TabCapture {
  constructor() {
    this.previewCache = new Map();
    this.storageStats = {
      totalSize: 0,
      previewCount: 0,
      lastCleanup: Date.now(),
    };
    this.initPromise = this.init();
  }

  /**
   * Initialize storage statistics
   */
  async init() {
    try {
      await this.calculateStorageStats();
      console.log('[TabCapture] Initialized. Storage stats:', this.storageStats);
    } catch (error) {
      console.error('[TabCapture] Init error:', error);
    }
  }

  /**
   * Ensure initialization is complete
   */
  async ensureInitialized() {
    await this.initPromise;
  }

  /**
   * Capture current tab content as base64 PNG
   * 
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<string|null>} Base64 PNG data URL or null
   */
  async captureTab(tabId) {
    try {
      await this.ensureInitialized();

      // Try to get visible tab capture first (if tab is active)
      const captureData = await this.requestTabCapture(tabId);
      
      if (!captureData) {
        console.warn('[TabCapture] No capture data received for tab', tabId);
        return null;
      }

      return captureData;
    } catch (error) {
      console.error('[TabCapture] Error capturing tab', tabId, ':', error);
      return null;
    }
  }

  /**
   * Capture with compression (quality 0.1-1.0)
   * 
   * @param {number} tabId - Chrome tab ID
   * @param {number} quality - Compression quality (0.1-1.0), default 0.7
   * @returns {Promise<string|null>} Compressed base64 PNG or null
   */
  async captureAndCompress(tabId, quality = 0.7) {
    try {
      await this.ensureInitialized();

      if (quality < 0.1 || quality > 1.0) {
        console.warn('[TabCapture] Quality out of range, using default');
        quality = 0.7;
      }

      // Request capture from content script
      const captureData = await this.requestTabCapture(tabId);
      
      if (!captureData) {
        return null;
      }

      // Compress via canvas if it's a data URL
      if (captureData.startsWith('data:image')) {
        const compressed = await this.compressImageDataUrl(captureData, quality);
        return compressed;
      }

      return captureData;
    } catch (error) {
      console.error('[TabCapture] Error capturing and compressing tab', tabId, ':', error);
      return null;
    }
  }

  /**
   * Get stored preview data URL for a tab
   * 
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<string|null>} Data URL or null
   */
  async getPreviewUrl(tabId) {
    try {
      await this.ensureInitialized();

      // Check cache first
      if (this.previewCache.has(tabId)) {
        return this.previewCache.get(tabId).base64;
      }

      // Load from storage
      const key = `${STORAGE_PREFIX}-${tabId}`;
      const result = await chrome.storage.local.get(key);
      
      if (result[key] && result[key].base64) {
        // Cache it
        this.previewCache.set(tabId, result[key]);
        return result[key].base64;
      }

      return null;
    } catch (error) {
      console.error('[TabCapture] Error getting preview URL for tab', tabId, ':', error);
      return null;
    }
  }

  /**
   * Store preview with metadata
   * 
   * @param {number} tabId - Chrome tab ID
   * @param {string} base64 - Data URL or base64 string
   * @param {Object} metadata - Preview metadata (title, URL, favicon)
   * @returns {Promise<boolean>} Success status
   */
  async storePreview(tabId, base64, metadata = {}) {
    try {
      await this.ensureInitialized();

      // Validate base64
      if (!base64 || typeof base64 !== 'string') {
        console.warn('[TabCapture] Invalid base64 data for tab', tabId);
        return false;
      }

      // Calculate size
      const size = new Blob([base64]).size;
      
      // Check size limit
      if (size > MAX_PREVIEW_SIZE) {
        console.warn(
          '[TabCapture] Preview too large for tab',
          tabId,
          `(${size} > ${MAX_PREVIEW_SIZE} bytes). Attempting compression.`
        );
        const compressed = await this.compressImageDataUrl(base64, 0.5);
        if (compressed && new Blob([compressed]).size <= MAX_PREVIEW_SIZE) {
          return this.storePreview(tabId, compressed, metadata);
        }
        return false;
      }

      // Prepare preview object
      const preview = {
        tabId,
        base64,
        title: metadata.title || '',
        url: metadata.url || '',
        favicon: metadata.favicon || '',
        timestamp: Date.now(),
        size,
      };

      // Store in chrome.storage.local
      const key = `${STORAGE_PREFIX}-${tabId}`;
      await chrome.storage.local.set({ [key]: preview });

      // Update cache
      this.previewCache.set(tabId, preview);

      // Update storage stats
      this.storageStats.totalSize += size;
      this.storageStats.previewCount += 1;

      console.log('[TabCapture] Stored preview for tab', tabId, `(${size} bytes)`);

      // Trigger cleanup if needed
      if (this.storageStats.previewCount % CLEANUP_BATCH_SIZE === 0) {
        this.scheduleCleanup();
      }

      return true;
    } catch (error) {
      console.error('[TabCapture] Error storing preview for tab', tabId, ':', error);
      return false;
    }
  }

  /**
   * Remove old previews based on age threshold
   * 
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @returns {Promise<number>} Number of previews removed
   */
  async cleanupOldPreviews(maxAgeMs = 86400000) { // Default: 24 hours
    try {
      await this.ensureInitialized();

      const result = await chrome.storage.local.get(null);
      const now = Date.now();
      let removedCount = 0;
      const keysToRemove = [];

      // Find old previews
      Object.entries(result).forEach(([key, value]) => {
        if (key.startsWith(STORAGE_PREFIX) && value.timestamp) {
          const age = now - value.timestamp;
          if (age > maxAgeMs) {
            keysToRemove.push(key);
            removedCount += 1;
            if (value.size) {
              this.storageStats.totalSize -= value.size;
            }
          }
        }
      });

      // Remove old previews
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        this.storageStats.previewCount = Math.max(0, this.storageStats.previewCount - removedCount);
        console.log('[TabCapture] Cleaned up', removedCount, 'old previews');
      }

      this.storageStats.lastCleanup = Date.now();
      return removedCount;
    } catch (error) {
      console.error('[TabCapture] Error cleaning up previews:', error);
      return 0;
    }
  }

  /**
   * Get statistics for all stored previews
   * 
   * @returns {Promise<Object>} Storage statistics
   */
  async getPreviewStats() {
    try {
      await this.ensureInitialized();
      await this.calculateStorageStats();

      return {
        totalSize: this.storageStats.totalSize,
        totalSizeKB: Math.round(this.storageStats.totalSize / 1024),
        previewCount: this.storageStats.previewCount,
        maxPerPreview: MAX_PREVIEW_SIZE,
        lastCleanup: this.storageStats.lastCleanup,
        estimatedQuotaUsagePercent: Math.round(
          (this.storageStats.totalSize / (10 * 1024 * 1024)) * 100 // Assume 10MB quota
        ),
      };
    } catch (error) {
      console.error('[TabCapture] Error getting preview stats:', error);
      return {
        totalSize: 0,
        totalSizeKB: 0,
        previewCount: 0,
        maxPerPreview: MAX_PREVIEW_SIZE,
        lastCleanup: 0,
        estimatedQuotaUsagePercent: 0,
      };
    }
  }

  /**
   * Request tab capture from content script via messaging
   * (Option C: Content Script Canvas Capture)
   * 
   * @private
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<string|null>} Base64 PNG data URL
   */
  async requestTabCapture(tabId) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(
          tabId,
          { action: 'captureTabPreview' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[TabCapture] Message error for tab', tabId, ':', chrome.runtime.lastError);
              resolve(null);
              return;
            }

            if (response && response.success && response.preview) {
              resolve(response.preview);
            } else {
              console.warn('[TabCapture] No preview in response for tab', tabId);
              resolve(null);
            }
          }
        );

        // Timeout after 5 seconds
        setTimeout(() => resolve(null), 5000);
      } catch (error) {
        console.error('[TabCapture] Error requesting capture for tab', tabId, ':', error);
        resolve(null);
      }
    });
  }

  /**
   * Compress image data URL to reduce file size
   * 
   * @private
   * @param {string} dataUrl - Image data URL
   * @param {number} quality - Compression quality (0.1-1.0)
   * @returns {Promise<string|null>} Compressed data URL
   */
  async compressImageDataUrl(dataUrl, quality = 0.7) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            
            // Scale width down to PREVIEW_WIDTH if wider, preserving aspect ratio
            if (img.width > PREVIEW_WIDTH) {
              const scale = PREVIEW_WIDTH / img.width;
              canvas.width = PREVIEW_WIDTH;
              canvas.height = Math.round(img.height * scale);
            } else {
              canvas.width = img.width;
              canvas.height = img.height;
            }

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed);
          } catch (error) {
            console.error('[TabCapture] Error during compression:', error);
            resolve(dataUrl);
          }
        };

        img.onerror = () => {
          console.error('[TabCapture] Error loading image for compression');
          resolve(null);
        };

        img.src = dataUrl;
      } catch (error) {
        console.error('[TabCapture] Error in compressImageDataUrl:', error);
        resolve(null);
      }
    });
  }

  /**
   * Calculate storage statistics
   * 
   * @private
   */
  async calculateStorageStats() {
    try {
      const result = await chrome.storage.local.get(null);
      let totalSize = 0;
      let previewCount = 0;

      Object.entries(result).forEach(([key, value]) => {
        if (key.startsWith(STORAGE_PREFIX)) {
          previewCount += 1;
          if (value.size) {
            totalSize += value.size;
          }
        }
      });

      this.storageStats.totalSize = totalSize;
      this.storageStats.previewCount = previewCount;
    } catch (error) {
      console.error('[TabCapture] Error calculating storage stats:', error);
    }
  }

  /**
   * Schedule cleanup on next idle period
   * 
   * @private
   */
  scheduleCleanup() {
    // Only clean up if it's been more than the interval since last cleanup
    const timeSinceLastCleanup = Date.now() - this.storageStats.lastCleanup;
    
    if (timeSinceLastCleanup > STORAGE_QUOTA_CHECK_INTERVAL) {
      // Clean up previews older than 24 hours
      this.cleanupOldPreviews(86400000).catch((error) => {
        console.error('[TabCapture] Scheduled cleanup error:', error);
      });
    }
  }

  /**
   * Clear all previews for a specific tab
   * 
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<boolean>} Success status
   */
  async clearTabPreview(tabId) {
    try {
      const key = `${STORAGE_PREFIX}-${tabId}`;
      const result = await chrome.storage.local.get(key);
      
      if (result[key] && result[key].size) {
        this.storageStats.totalSize -= result[key].size;
      }

      await chrome.storage.local.remove(key);
      this.previewCache.delete(tabId);
      this.storageStats.previewCount = Math.max(0, this.storageStats.previewCount - 1);

      return true;
    } catch (error) {
      console.error('[TabCapture] Error clearing preview for tab', tabId, ':', error);
      return false;
    }
  }

  /**
   * Clear all previews
   * 
   * @returns {Promise<number>} Number of previews cleared
   */
  async clearAllPreviews() {
    try {
      const result = await chrome.storage.local.get(null);
      const keysToRemove = [];

      Object.keys(result).forEach((key) => {
        if (key.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      });

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }

      this.previewCache.clear();
      this.storageStats.totalSize = 0;
      this.storageStats.previewCount = 0;

      console.log('[TabCapture] Cleared all', keysToRemove.length, 'previews');
      return keysToRemove.length;
    } catch (error) {
      console.error('[TabCapture] Error clearing all previews:', error);
      return 0;
    }
  }
}

// Singleton instance
let tabCaptureInstance = null;

/**
 * Get or create TabCapture singleton
 */
function getTabCapture() {
  if (!tabCaptureInstance) {
    tabCaptureInstance = new TabCapture();
  }
  return tabCaptureInstance;
}

/**
 * Export for use in service worker and content script
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabCapture, getTabCapture };
}
