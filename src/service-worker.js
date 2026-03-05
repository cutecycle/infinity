/**
 * Infinity Chrome Extension - Service Worker
 * Handles background tasks and event listeners
 */

import { log, saveToStorage, getFromStorage } from './utils.js';

/**
 * Initialize service worker
 */
function initializeServiceWorker() {
  log('Service Worker initialized');
}

/**
 * Listen for tab creation
 */
chrome.tabs.onCreated.addListener((tab) => {
  log('Tab created', { tabId: tab.id, url: tab.url });
});

/**
 * Listen for tab removal
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  log('Tab removed', { tabId, windowId: removeInfo.windowId });
});

/**
 * Listen for window creation
 */
chrome.windows.onCreated.addListener((window) => {
  log('Window created', { windowId: window.id });
});

/**
 * Listen for window removal
 */
chrome.windows.onRemoved.addListener((windowId) => {
  log('Window removed', { windowId });
});

/**
 * Listen for messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTabs') {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      sendResponse({ tabs });
    });
    return true;
  }

  if (request.action === 'getWindows') {
    chrome.windows.getAll((windows) => {
      sendResponse({ windows });
    });
    return true;
  }

  if (request.action === 'saveSettings') {
    saveToStorage('settings', request.data).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'getSettings') {
    getFromStorage('settings').then((settings) => {
      sendResponse({ settings: settings || {} });
    });
    return true;
  }

  if (request.action === 'wakeTab') {
    // Forward wake request to the specific tab's content script
    if (sender.tab && sender.tab.id) {
      chrome.tabs.sendMessage(sender.tab.id, { action: 'wake', options: request.options }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true;
    }
  }
});

// Initialize on service worker startup
initializeServiceWorker();
