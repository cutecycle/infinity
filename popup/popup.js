/**
 * Infinity Chrome Extension - Popup Script
 * Handles popup UI interactions
 */

/**
 * Load and display window and tab statistics
 */
async function loadStats() {
  // Get windows
  chrome.windows.getAll((windows) => {
    document.getElementById('windowCount').textContent = windows.length;
  });

  // Get tabs in current window
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    document.getElementById('tabCount').textContent = tabs.length;
    displayTabs(tabs);
  });
}

/**
 * Display list of current tabs
 */
function displayTabs(tabs) {
  const tabsList = document.getElementById('tabsList');
  tabsList.innerHTML = '';

  tabs.forEach((tab) => {
    const li = document.createElement('li');
    li.className = 'tab-item';
    
    const favicon = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="0" y="14" font-size="14">📄</text></svg>';
    
    li.innerHTML = `
      <img src="${favicon}" class="tab-favicon" alt="">
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <button class="tab-close" data-tab-id="${tab.id}">×</button>
    `;
    
    li.querySelector('.tab-close').addEventListener('click', () => {
      chrome.tabs.remove(tab.id);
      loadStats();
    });

    tabsList.appendChild(li);
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialize popup
 */
function initializePopup() {
  loadStats();

  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('closeAllTabsBtn').addEventListener('click', () => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const tabIds = tabs.map((tab) => tab.id);
      chrome.tabs.remove(tabIds);
      loadStats();
    });
  });
}

// Initialize when popup is opened
document.addEventListener('DOMContentLoaded', initializePopup);
