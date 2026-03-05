/**
 * Tab Wake Mechanism for Infinity Chrome Extension
 * Handles restoration of slept tabs: DOM, scroll position, form data, and session state
 */

import { saveToStorage, getFromStorage, removeFromStorage, log } from '../utils.js';

/**
 * Unique key prefix for storing tab state
 * @type {string}
 */
const STATE_PREFIX = 'tab-state-';
const CACHE_PREFIX = 'tab-cache-';

/**
 * Wait for DOM to be ready
 * @returns {Promise<void>}
 */
function waitForDOM() {
  return new Promise((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve);
    } else {
      resolve();
    }
  });
}

/**
 * Wait for images to load (lazy loading support)
 * @param {number} timeout Maximum time to wait in ms (default 5000)
 * @returns {Promise<void>}
 */
function waitForImagesLoaded(timeout = 5000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, timeout);
    
    // Count pending images
    const images = Array.from(document.querySelectorAll('img'));
    if (images.length === 0) {
      clearTimeout(timeoutId);
      resolve();
      return;
    }

    let loadedCount = 0;
    const checkComplete = () => {
      loadedCount++;
      if (loadedCount === images.length) {
        clearTimeout(timeoutId);
        resolve();
      }
    };

    images.forEach((img) => {
      if (img.complete) {
        checkComplete();
      } else {
        img.addEventListener('load', checkComplete, { once: true });
        img.addEventListener('error', checkComplete, { once: true });
      }
    });
  });
}

/**
 * Save current page state before sleeping
 * Captures form data and scroll position
 * @returns {Promise<void>}
 */
export async function savePageState() {
  const tabId = chrome.runtime.getURL('').split('/')[3]; // Extract tab ID from URL
  const stateKey = `${STATE_PREFIX}${window.location.href}`;

  const state = {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    formData: captureFormData(),
    sessionStorageData: captureSessionStorage(),
  };

  try {
    await saveToStorage(stateKey, state);
    log('Page state saved', { url: state.url });
  } catch (error) {
    log('Error saving page state', { error: error.message });
  }
}

/**
 * Capture form data from all inputs and textareas
 * @returns {Object}
 */
function captureFormData() {
  const formData = {};

  // Capture input and textarea values
  document.querySelectorAll('input, textarea, select').forEach((element) => {
    if (!element.name) return;

    if (element.type === 'checkbox' || element.type === 'radio') {
      formData[element.name] = element.checked;
    } else {
      formData[element.name] = element.value;
    }
  });

  return formData;
}

/**
 * Capture sessionStorage data
 * @returns {Object}
 */
function captureSessionStorage() {
  const data = {};
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      data[key] = sessionStorage.getItem(key);
    }
  } catch (error) {
    log('Error reading sessionStorage', { error: error.message });
  }
  return data;
}

/**
 * Restore form data to the page
 * @param {Object} formData Previously captured form data
 */
function restoreFormData(formData) {
  if (!formData || typeof formData !== 'object') return;

  Object.entries(formData).forEach(([name, value]) => {
    const elements = document.querySelectorAll(`[name="${CSS.escape(name)}"]`);
    elements.forEach((element) => {
      if (element.type === 'checkbox' || element.type === 'radio') {
        element.checked = value;
      } else {
        element.value = value;
      }
      // Trigger change event for reactive frameworks
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

/**
 * Restore sessionStorage data
 * @param {Object} sessionStorageData Previously captured session storage
 */
function restoreSessionStorage(sessionStorageData) {
  if (!sessionStorageData || typeof sessionStorageData !== 'object') return;

  try {
    Object.entries(sessionStorageData).forEach(([key, value]) => {
      sessionStorage.setItem(key, value);
    });
  } catch (error) {
    log('Error restoring sessionStorage', { error: error.message });
  }
}

/**
 * Restore scroll position using requestAnimationFrame
 * @param {number} scrollY Target Y position
 * @param {number} scrollX Target X position (default 0)
 */
function restoreScrollPosition(scrollY, scrollX = 0) {
  if (!scrollY && scrollY !== 0) return;

  // Use requestAnimationFrame for smooth restoration
  requestAnimationFrame(() => {
    window.scrollTo(scrollX, scrollY);
  });
}

/**
 * Remove the preview/sleep indicator from the page
 * Looks for elements with class or data attributes indicating preview state
 */
function removePreviewIndicator() {
  // Remove preview container if it exists
  const previewContainers = document.querySelectorAll(
    '[data-infinity-preview], .infinity-preview, .tab-preview, .sleep-preview'
  );
  previewContainers.forEach((el) => {
    el.remove();
  });

  // Remove overlay if present
  const overlays = document.querySelectorAll('[data-infinity-overlay]');
  overlays.forEach((el) => {
    el.remove();
  });
}

/**
 * Reload page from URL (primary strategy)
 * @returns {Promise<void>}
 */
async function reloadFromURL() {
  return new Promise((resolve) => {
    // Add a small delay to ensure service worker is ready
    setTimeout(() => {
      window.location.reload();
      resolve();
    }, 100);
  });
}

/**
 * Main wake function - restores a slept tab
 * @param {Object} options Configuration options
 * @returns {Promise<Object>} Wake result with status and timing information
 */
export async function wakeTab(options = {}) {
  const startTime = performance.now();
  const {
    useCache = false,
    timeout = 30000,
  } = options;

  try {
    log('Starting tab wake sequence', { url: window.location.href });

    // Step 1: Remove preview indicator
    removePreviewIndicator();
    log('Preview indicator removed');

    // Step 2: Retrieve saved state
    const stateKey = `${STATE_PREFIX}${window.location.href}`;
    const savedState = await getFromStorage(stateKey);

    // Step 3: Reload page (primary strategy)
    log('Reloading page from URL');
    
    if (useCache && savedState) {
      // Optional: Use cached HTML if available (for small pages)
      await restoreFromCache(savedState);
    } else {
      // Primary: Reload from URL
      await reloadFromURL();
    }

    // Wait for page to stabilize
    await waitForDOM();
    await waitForImagesLoaded(5000);

    // Step 4: Restore form data
    if (savedState && savedState.formData) {
      restoreFormData(savedState.formData);
      log('Form data restored');
    }

    // Step 5: Restore session storage
    if (savedState && savedState.sessionStorageData) {
      restoreSessionStorage(savedState.sessionStorageData);
      log('Session storage restored');
    }

    // Step 6: Restore scroll position
    if (savedState && (savedState.scrollY || savedState.scrollY === 0)) {
      restoreScrollPosition(savedState.scrollY, savedState.scrollX || 0);
      log('Scroll position restored');
    }

    // Step 7: Mark as awake and fully loaded
    document.documentElement.setAttribute('data-infinity-awake', 'true');
    document.documentElement.setAttribute('data-infinity-loaded', Date.now());

    const elapsedTime = performance.now() - startTime;
    const result = {
      status: 'success',
      message: 'Tab successfully woken up',
      timeToInteractive: Math.round(elapsedTime),
      url: window.location.href,
    };

    log('Tab wake sequence completed', result);
    return result;

  } catch (error) {
    log('Error during tab wake', { error: error.message, stack: error.stack });
    
    // Graceful degradation: Notify user
    return {
      status: 'error',
      message: `Failed to wake tab: ${error.message}`,
      error: error.message,
    };
  }
}

/**
 * Optional: Restore page from cached HTML
 * @param {Object} savedState Previously saved state with cached HTML
 * @returns {Promise<void>}
 */
async function restoreFromCache(savedState) {
  const cacheKey = `${CACHE_PREFIX}${window.location.href}`;
  const cachedHTML = await getFromStorage(cacheKey);

  if (!cachedHTML) {
    // No cache available, reload from URL
    await reloadFromURL();
    return;
  }

  try {
    // Replace document content with cached HTML
    document.documentElement.innerHTML = cachedHTML;
    log('Page restored from cache');
  } catch (error) {
    log('Error restoring from cache, reloading URL', { error: error.message });
    await reloadFromURL();
  }
}

/**
 * Cache the original HTML of a page (for small pages only)
 * Only cache pages smaller than 1MB
 * @returns {Promise<void>}
 */
export async function cachePageHTML() {
  try {
    const html = document.documentElement.outerHTML;
    
    // Only cache if page is small (< 1MB)
    const sizeInMB = new Blob([html]).size / 1024 / 1024;
    if (sizeInMB > 1) {
      log('Page too large to cache', { sizeInMB });
      return;
    }

    const cacheKey = `${CACHE_PREFIX}${window.location.href}`;
    await saveToStorage(cacheKey, html);
    log('Page HTML cached', { sizeInMB });

  } catch (error) {
    log('Error caching page HTML', { error: error.message });
  }
}

/**
 * Clean up stored state for a specific URL
 * @param {string} url Page URL to clean up
 * @returns {Promise<void>}
 */
export async function cleanupPageState(url) {
  try {
    const stateKey = `${STATE_PREFIX}${url}`;
    const cacheKey = `${CACHE_PREFIX}${url}`;
    
    await removeFromStorage(stateKey);
    await removeFromStorage(cacheKey);
    
    log('Page state cleaned up', { url });
  } catch (error) {
    log('Error cleaning up page state', { error: error.message });
  }
}

/**
 * Initialize tab wake listener
 * Sets up message handler for wake requests from service worker
 */
export function initializeWakeListener() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'wake') {
      log('Wake message received');
      
      wakeTab(request.options || {})
        .then((result) => {
          sendResponse({
            success: result.status === 'success',
            ...result,
          });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            status: 'error',
            message: error.message,
          });
        });

      // Return true to indicate we'll send response asynchronously
      return true;
    }
  });

  log('Wake listener initialized');
}
