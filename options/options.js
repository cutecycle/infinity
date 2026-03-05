/**
 * Infinity Chrome Extension - Options Page Script
 * Handles settings management
 */

const DEFAULT_SETTINGS = {
  autoSortTabs: false,
  showNotifications: true,
  closeConfirm: true,
  maxTabs: 50,
};

/**
 * Load settings from storage and populate form
 */
async function loadSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || DEFAULT_SETTINGS;

    document.getElementById('autoSortTabs').checked = settings.autoSortTabs || false;
    document.getElementById('showNotifications').checked = settings.showNotifications !== false;
    document.getElementById('closeConfirm').checked = settings.closeConfirm !== false;
    document.getElementById('maxTabs').value = settings.maxTabs || 50;
  });
}

/**
 * Save settings to storage
 */
function saveSettings() {
  const settings = {
    autoSortTabs: document.getElementById('autoSortTabs').checked,
    showNotifications: document.getElementById('showNotifications').checked,
    closeConfirm: document.getElementById('closeConfirm').checked,
    maxTabs: parseInt(document.getElementById('maxTabs').value, 10),
  };

  chrome.storage.local.set({ settings }, () => {
    showStatus('Settings saved successfully!', 'success');
  });
}

/**
 * Export settings to JSON file
 */
function exportSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || DEFAULT_SETTINGS;
    const dataStr = JSON.stringify(settings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'infinity-settings.json';
    link.click();
    URL.revokeObjectURL(url);
  });
}

/**
 * Import settings from JSON file
 */
function importSettings() {
  document.getElementById('importFile').click();
}

document.getElementById('importFile').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const settings = JSON.parse(e.target.result);
      chrome.storage.local.set({ settings }, () => {
        loadSettings();
        showStatus('Settings imported successfully!', 'success');
      });
    } catch (error) {
      showStatus('Error importing settings: Invalid JSON', 'error');
    }
  };
  reader.readAsText(file);
});

/**
 * Reset to default settings
 */
function resetSettings() {
  if (confirm('Are you sure? This will reset all settings to their default values.')) {
    chrome.storage.local.set({ settings: DEFAULT_SETTINGS }, () => {
      loadSettings();
      showStatus('Settings reset to defaults', 'success');
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

/**
 * Initialize options page
 */
function initializeOptions() {
  loadSettings();

  document.getElementById('saveButton').addEventListener('click', saveSettings);
  document.getElementById('exportButton').addEventListener('click', exportSettings);
  document.getElementById('importButton').addEventListener('click', importSettings);
  document.getElementById('resetButton').addEventListener('click', resetSettings);
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initializeOptions);
