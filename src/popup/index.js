/**
 * Popup Script for Infinity Chrome Extension
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup loaded');

  // Send message to service worker
  chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
    if (response && response.status === 'pong') {
      console.log('Service worker responded');
    }
  });
});
