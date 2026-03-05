/**
 * Infinity Chrome Extension - Content Script
 * Runs on every page and handles page-specific interactions
 */

import { initializeWakeListener, savePageState } from './utils/tab-wake.js';

/**
 * Initialize content script
 */
function initializeContentScript() {
  console.log('[Infinity] Content script loaded on:', window.location.href);
  
  // Initialize tab wake listener
  initializeWakeListener();
}

/**
 * Send message to service worker
 */
function sendMessageToWorker(action, data) {
  chrome.runtime.sendMessage(
    { action, data },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Infinity] Message error:', chrome.runtime.lastError);
      } else {
        console.log('[Infinity] Response:', response);
      }
    }
  );
}

/**
 * Listen for messages from the extension
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Infinity] Message received:', request);

  if (request.action === 'getPageInfo') {
    sendResponse({
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
    });
  }

  if (request.action === 'savePageState') {
    savePageState().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

// Initialize content script
initializeContentScript();
