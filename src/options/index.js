/**
 * Options Script for Infinity Chrome Extension
 */

document.addEventListener('DOMContentLoaded', () => {
  const setting1Input = document.getElementById('setting1');
  const saveButton = document.getElementById('save');

  // Load saved settings
  chrome.storage.sync.get(['setting1'], (result) => {
    if (result.setting1) {
      setting1Input.value = result.setting1;
    }
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const value = setting1Input.value;
    chrome.storage.sync.set({ setting1: value }, () => {
      console.log('Settings saved');
      alert('Settings saved successfully!');
    });
  });
});
