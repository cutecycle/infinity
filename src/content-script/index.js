/**
 * Content Script for Infinity Chrome Extension
 * This script runs in the context of web pages
 */

console.log('Infinity content script loaded');

// Import TabSleep module
const TabSleep = require('../tab-sleep.js');

// Initialize tab sleep
const tabSleep = new TabSleep();

// Setup message listener for tab sleep commands
tabSleep.setupMessageListener();

// Send a message to the background service worker
chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
  if (response && response.status === 'pong') {
    console.log('Service worker is alive');
  }
});
