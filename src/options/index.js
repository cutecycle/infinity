/**
 * Options Script for Infinity Chrome Extension
 */

const DEFAULT_SLEEP_THRESHOLD = 15000; // 15 seconds

/**
 * Load sleep threshold from service worker and populate the form
 */
function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getPreferences' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('Could not load preferences:', chrome.runtime.lastError);
      return;
    }
    if (response && response.success) {
      const sleepDelay = document.getElementById('sleepDelay');
      if (sleepDelay) {
        sleepDelay.value = String(response.preferences.sleepThreshold ?? DEFAULT_SLEEP_THRESHOLD);
      }
    }
  });
}

/**
 * Save settings
 */
function saveSettings() {
  const sleepThreshold = parseInt(document.getElementById('sleepDelay').value, 10);

  chrome.runtime.sendMessage({
    action: 'updatePreferences',
    preferences: { sleepThreshold },
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Error saving settings.', 'error');
      return;
    }
    if (response && response.success) {
      showStatus('Settings saved successfully!', 'success');
    } else {
      showStatus('Error saving settings.', 'error');
    }
  });
}

/**
 * Reset to default settings
 */
function resetSettings() {
  if (confirm('Are you sure? This will reset all settings to their default values.')) {
    chrome.runtime.sendMessage({
      action: 'updatePreferences',
      preferences: { sleepThreshold: DEFAULT_SLEEP_THRESHOLD },
    }, (response) => {
      if (response && response.success) {
        loadSettings();
        showStatus('Settings reset to defaults.', 'success');
      }
    });
  }
}

/**
 * Display status message
 */
function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status-message';
  }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('saveButton').addEventListener('click', saveSettings);
  document.getElementById('resetButton').addEventListener('click', resetSettings);
});
