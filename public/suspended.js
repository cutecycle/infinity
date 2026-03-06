/**
 * Suspended tab page — restores the original URL when the user interacts.
 * URL params: ?url=<encoded_original_url>&title=<encoded_title>&preview=<storage_key>
 */

const params = new URLSearchParams(window.location.search);
const originalUrl = params.get('url');
const title = params.get('title') || 'Suspended Tab';
const previewKey = params.get('preview');

// Set the page title to match the original tab (shows in tab strip + alt-tab)
document.title = `💤 ${title}`;
document.getElementById('page-title').textContent = `💤 ${title}`;
document.getElementById('tab-title').textContent = title;
document.getElementById('tab-url').textContent = originalUrl || '';

// Load preview image from storage
if (previewKey) {
  chrome.storage.local.get([previewKey], (result) => {
    const data = result[previewKey];
    if (data && data.preview) {
      const img = document.getElementById('preview');
      img.src = data.preview;
      img.style.display = 'block';
      document.getElementById('no-preview').style.display = 'none';
    }
  });
}

// Wake up: navigate back to the original URL
function wake() {
  if (originalUrl) {
    window.location.replace(originalUrl);
  }
}

// Wake on click anywhere
document.addEventListener('click', wake);

// Wake when this tab becomes visible (user switched to it)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    wake();
  }
});

// Also listen for messages from the service worker to wake
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'wake') {
    wake();
  }
});
