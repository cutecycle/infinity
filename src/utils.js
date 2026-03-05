/**
 * Utility functions for Infinity extension
 */

/**
 * Get all open tabs in the current window
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function getCurrentWindowTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      resolve(tabs);
    });
  });
}

/**
 * Get all open windows
 * @returns {Promise<chrome.windows.Window[]>}
 */
export async function getAllWindows() {
  return new Promise((resolve) => {
    chrome.windows.getAll((windows) => {
      resolve(windows);
    });
  });
}

/**
 * Save data to chrome storage
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function saveToStorage(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve();
    });
  });
}

/**
 * Get data from chrome storage
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function getFromStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

/**
 * Remove data from chrome storage
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function removeFromStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove([key], () => {
      resolve();
    });
  });
}

/**
 * Log message to console with timestamp
 * @param {string} message
 * @param {*} data
 */
export function log(message, data) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[Infinity ${timestamp}] ${message}`, data || '');
}
