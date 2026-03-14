/**
 * Tab Sleep Module for Infinity Chrome Extension
 * Manages DOM state capture, suspension, and restoration of unfocused tabs
 */

class TabSleep {
  constructor() {
    this.isAsleep = false;
    this.savedState = null;
    this.eventListeners = [];
    this.timers = [];
    this.iframes = [];
    this.previewContainer = null;
    this.originalBodyContent = null;
    this.frozenScripts = [];
  }

  /**
   * Capture current DOM state before sleeping
   */
  captureState() {
    try {
      const state = {
        url: window.location.href,
        title: document.title,
        scrollPosition: {
          x: window.scrollX || document.documentElement.scrollLeft,
          y: window.scrollY || document.documentElement.scrollTop,
        },
        formData: this.captureFormData(),
        sessionStorage: this.captureSessionStorage(),
        timestamp: Date.now(),
      };

      this.savedState = state;
      return state;
    } catch (error) {
      console.error('[TabSleep] Error capturing state:', error);
      return null;
    }
  }

  /**
   * Capture all form input values
   */
  captureFormData() {
    const formData = {};
    try {
      // Capture input elements
      document.querySelectorAll('input, textarea, select').forEach((element) => {
        if (element.id) {
          if (element.type === 'checkbox' || element.type === 'radio') {
            formData[element.id] = element.checked;
          } else {
            formData[element.id] = element.value;
          }
        }
      });
    } catch (error) {
      console.error('[TabSleep] Error capturing form data:', error);
    }
    return formData;
  }

  /**
   * Capture session storage data
   */
  captureSessionStorage() {
    const sessionData = {};
    try {
      if (typeof sessionStorage !== 'undefined') {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          sessionData[key] = sessionStorage.getItem(key);
        }
      }
    } catch (error) {
      console.error('[TabSleep] Error capturing session storage:', error);
    }
    return sessionData;
  }

  /**
   * Capture page as a preview image
   */
  async capturePreview() {
    try {
      // Avoid trying to capture pages that can't be rendered
      if (this.isUnsleepablePage()) {
        console.warn('[TabSleep] Page type not suitable for preview capture');
        return null;
      }

      // Use canvas to capture visible portion or create a placeholder
      const canvas = await this.createPreviewCanvas();
      if (canvas) {
        return canvas.toDataURL('image/png');
      }
      return null;
    } catch (error) {
      console.error('[TabSleep] Error capturing preview:', error);
      return null;
    }
  }

  /**
   * Create a canvas preview of the full page
   */
  async createPreviewCanvas() {
    try {
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      });
      return canvas;
    } catch (error) {
      console.error('[TabSleep] Error creating preview canvas:', error);
      return null;
    }
  }

  /**
   * Check if page should not be slept
   */
  isUnsleepablePage() {
    const url = window.location.href;
    
    // Skip chrome pages
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      return true;
    }
    
    // Skip PDFs (basic check)
    if (url.toLowerCase().endsWith('.pdf')) {
      return true;
    }
    
    // Skip pages with WebSockets or critical functionality
    if (window.__CRITICAL_JS_EXECUTION__) {
      console.warn('[TabSleep] Page has critical JS execution flag');
      return true;
    }

    return false;
  }

  /**
   * Remove all event listeners from page
   */
  removeEventListeners() {
    try {
      const eventTypes = [
        'click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout',
        'scroll', 'wheel', 'touchstart', 'touchend', 'touchmove',
        'keydown', 'keyup', 'keypress', 'input', 'change', 'focus', 'blur',
        'load', 'beforeunload', 'unload', 'resize', 'orientationchange',
        'submit', 'reset', 'drag', 'drop', 'dragover', 'dragenter', 'dragleave'
      ];

      eventTypes.forEach((eventType) => {
        try {
          // Clone and replace event listeners for common elements
          const elements = document.querySelectorAll('*');
          elements.forEach((element) => {
            const clone = element.cloneNode(true);
            // This removes all listeners via cloning
            if (element.parentNode) {
              element.parentNode.replaceChild(clone, element);
            }
          });
        } catch (e) {
          // Silent fail - some elements can't be cloned
        }
      });

      console.log('[TabSleep] Event listeners removed');
    } catch (error) {
      console.error('[TabSleep] Error removing event listeners:', error);
    }
  }

  /**
   * Unload all iframes
   */
  unloadIframes() {
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((iframe) => {
        this.iframes.push({
          element: iframe,
          src: iframe.src,
          html: iframe.outerHTML,
        });
        iframe.src = '';
        iframe.sandbox.add('allow-same-origin');
      });
      console.log('[TabSleep] Unloaded', iframes.length, 'iframes');
    } catch (error) {
      console.error('[TabSleep] Error unloading iframes:', error);
    }
  }

  /**
   * Clear all timers and intervals
   */
  clearTimers() {
    try {
      // Store max timer IDs to clear
      const maxId = 100000;
      for (let i = 0; i < maxId; i++) {
        clearTimeout(i);
        clearInterval(i);
      }
      console.log('[TabSleep] Cleared timers and intervals');
    } catch (error) {
      console.error('[TabSleep] Error clearing timers:', error);
    }
  }

  /**
   * Freeze JavaScript execution
   */
  freezeJavaScript() {
    try {
      // Disable fetch API
      const originalFetch = window.fetch;
      window.fetch = function() {
        console.warn('[TabSleep] Fetch blocked - tab is sleeping');
        return Promise.reject(new Error('Tab is sleeping'));
      };

      // Disable XMLHttpRequest
      const originalXHR = window.XMLHttpRequest;
      window.XMLHttpRequest = function() {
        throw new Error('XHR blocked - tab is sleeping');
      };
      window.XMLHttpRequest.prototype = originalXHR.prototype;

      // Disable WebSocket
      const originalWebSocket = window.WebSocket;
      window.WebSocket = function() {
        throw new Error('WebSocket blocked - tab is sleeping');
      };

      // Set execution freeze flag
      window.__TAB_IS_SLEEPING__ = true;

      console.log('[TabSleep] JavaScript execution frozen');
    } catch (error) {
      console.error('[TabSleep] Error freezing JavaScript:', error);
    }
  }

  /**
   * Unfreeze JavaScript execution (for wake)
   */
  unfreezeJavaScript() {
    try {
      // This would need to store original functions
      window.__TAB_IS_SLEEPING__ = false;
      console.log('[TabSleep] JavaScript execution unfrozen');
    } catch (error) {
      console.error('[TabSleep] Error unfreezing JavaScript:', error);
    }
  }

  /**
   * Create and display preview container
   */
  async displayPreview(previewDataUrl) {
    try {
      // Store original body HTML
      this.originalBodyContent = document.body.innerHTML;

      // Clear existing preview
      if (this.previewContainer) {
        this.previewContainer.remove();
      }

      // Create preview container
      const container = document.createElement('div');
      container.id = 'tab-sleep-preview-container';
      container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
        background-color: #ffffff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      `;

      if (previewDataUrl) {
        // Display captured preview image
        const img = document.createElement('img');
        img.src = previewDataUrl;
        img.style.cssText = `
          max-width: 90%;
          max-height: 85%;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          object-fit: contain;
        `;
        container.appendChild(img);
      }

      // Add sleeping indicator
      const indicator = document.createElement('div');
      indicator.style.cssText = `
        margin-top: 20px;
        padding: 10px 20px;
        background-color: #f0f0f0;
        border-radius: 4px;
        text-align: center;
        font-size: 14px;
        color: #666;
      `;
      indicator.innerHTML = `<span style="font-size: 20px; margin-right: 8px;">💤</span>
        This tab is sleeping to save resources. Switch back to wake it.`;
      container.appendChild(indicator);

      // Add page title
      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = `
        margin-top: 15px;
        font-size: 12px;
        color: #999;
        text-align: center;
      `;
      titleDiv.textContent = `${document.title} • ${new Date().toLocaleTimeString()}`;
      container.appendChild(titleDiv);

      document.body.appendChild(container);
      this.previewContainer = container;

      console.log('[TabSleep] Preview displayed');
    } catch (error) {
      console.error('[TabSleep] Error displaying preview:', error);
    }
  }

  /**
   * Put page to sleep
   */
  async sleep(options = {}) {
    if (this.isAsleep) {
      console.warn('[TabSleep] Tab is already sleeping');
      return { success: false, reason: 'already_sleeping' };
    }

    try {
      // Check if page should be slept
      if (this.isUnsleepablePage()) {
        return { success: false, reason: 'unsleepable_page' };
      }

      console.log('[TabSleep] Putting tab to sleep...');

      // Capture state
      this.captureState();

      // Capture preview
      const preview = await this.capturePreview();

      // Remove event listeners (before other modifications)
      this.removeEventListeners();

      // Unload iframes
      this.unloadIframes();

      // Clear timers
      this.clearTimers();

      // Freeze JavaScript
      this.freezeJavaScript();

      // Display preview
      await this.displayPreview(preview);

      this.isAsleep = true;

      console.log('[TabSleep] Tab is now sleeping');
      return { 
        success: true, 
        state: this.savedState,
        preview: preview 
      };
    } catch (error) {
      console.error('[TabSleep] Error putting tab to sleep:', error);
      return { success: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Wake up the page
   */
  async wake() {
    if (!this.isAsleep) {
      console.warn('[TabSleep] Tab is not sleeping');
      return { success: false, reason: 'not_sleeping' };
    }

    try {
      console.log('[TabSleep] Waking tab...');

      // Remove preview container
      if (this.previewContainer) {
        this.previewContainer.remove();
        this.previewContainer = null;
      }

      // Restore original body content
      if (this.originalBodyContent) {
        document.body.innerHTML = this.originalBodyContent;
      }

      // Restore iframes
      this.iframes.forEach((iframeData) => {
        try {
          if (iframeData.element && iframeData.element.parentNode) {
            iframeData.element.src = iframeData.src;
          }
        } catch (error) {
          console.warn('[TabSleep] Error restoring iframe:', error);
        }
      });

      // Restore scroll position
      if (this.savedState && this.savedState.scrollPosition) {
        window.scrollTo(this.savedState.scrollPosition.x, this.savedState.scrollPosition.y);
      }

      // Unfreeze JavaScript
      this.unfreezeJavaScript();

      this.isAsleep = false;

      // Reload page to fully restore functionality
      if (window.location.hash === '#tab-sleep-restored') {
        // Avoid infinite reload
        window.location.hash = '';
      } else {
        window.location.hash = '#tab-sleep-restored';
        window.location.reload();
      }

      console.log('[TabSleep] Tab is now awake');
      return { success: true };
    } catch (error) {
      console.error('[TabSleep] Error waking tab:', error);
      return { success: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Capture current page as preview for TabCapture module
   * Responds to 'captureTabPreview' action from service worker
   */
  async handleCapturePreviewRequest() {
    try {
      // If tab is already sleeping, use existing preview
      if (this.isAsleep && this.previewContainer) {
        const img = this.previewContainer.querySelector('img');
        if (img && img.src) {
          return {
            success: true,
            preview: img.src,
          };
        }
      }

      // Otherwise, capture a fresh preview
      const preview = await this.capturePreview();
      
      if (preview) {
        return {
          success: true,
          preview,
        };
      }

      return {
        success: false,
        error: 'Failed to capture preview',
      };
    } catch (error) {
      console.error('[TabSleep] Error handling capture preview request:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Listen for messages from service worker
   */
  setupMessageListener() {
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'sleep') {
          console.log('[TabSleep] Received sleep message');
          this.sleep({ preview: request.preview }).then((result) => {
            sendResponse(result);
          });
          return true; // Will send response asynchronously
        } else if (request.action === 'wake') {
          console.log('[TabSleep] Received wake message');
          this.wake().then((result) => {
            sendResponse(result);
          });
          return true;
        } else if (request.action === 'checkForForms') {
          // Only block sleep for traditional forms with substantial user-entered data
          // (e.g. registration, checkout, compose) — not SPA inputs managed by frameworks
          const forms = document.querySelectorAll('form');
          const hasDirtyForm = Array.from(forms).some((form) => {
            // Skip SPA-style forms without traditional submit attributes
            if (!form.hasAttribute('action') && !form.hasAttribute('method')) return false;

            const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
            return Array.from(inputs).some((el) => {
              // Skip invisible elements (framework-managed hidden state)
              if (el.offsetParent === null && el.type !== 'hidden') return false;
              if (el.type === 'checkbox' || el.type === 'radio') return el.checked && el.defaultChecked !== el.checked;
              return el.value.trim().length > 0 && el.value !== el.defaultValue;
            });
          });
          sendResponse({ hasForms: hasDirtyForm });
          return false;
        } else if (request.action === 'captureTabPreview') {
          console.log('[TabSleep] Received capture preview request');
          this.handleCapturePreviewRequest().then((result) => {
            sendResponse(result);
          });
          return true;
        } else if (request.action === 'scrollToTop') {
          window.scrollTo(0, 0);
          sendResponse({ success: true });
          return false;
        }
      });

      console.log('[TabSleep] Message listener setup');
    } catch (error) {
      console.error('[TabSleep] Error setting up message listener:', error);
    }
  }

  /**
   * Get current sleep status
   */
  getStatus() {
    return {
      isAsleep: this.isAsleep,
      savedState: this.savedState,
      hasPreview: !!this.previewContainer,
    };
  }
}

export default TabSleep;
