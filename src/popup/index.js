/**
 * Infinity Popup - Shows tab sleep status across all windows
 */

async function getStats() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSleepStats' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        resolve({ total: 0, awake: 0, sleeping: 0, tabs: [] });
        return;
      }
      resolve(response.stats);
    });
  });
}

async function render() {
  const stats = await getStats();

  document.getElementById('total').textContent = stats.total;
  document.getElementById('awake').textContent = stats.awake;
  document.getElementById('sleeping').textContent = stats.sleeping;

  const list = document.getElementById('tab-list');
  list.innerHTML = '';

  if (stats.tabs.length === 0) {
    list.innerHTML = '<div class="empty">No tabs tracked yet. Switch between windows to start.</div>';
    return;
  }

  const sleeping = stats.tabs.filter(t => t.state === 'sleeping');
  const awake = stats.tabs.filter(t => t.state === 'awake');

  if (sleeping.length > 0) {
    const header = document.createElement('div');
    header.className = 'section-header';
    header.textContent = `💤 Sleeping (${sleeping.length})`;
    list.appendChild(header);
    sleeping.forEach(tab => list.appendChild(createTabRow(tab)));
  }

  if (awake.length > 0) {
    const header = document.createElement('div');
    header.className = 'section-header';
    header.textContent = `🟢 Awake (${awake.length})`;
    list.appendChild(header);
    awake.forEach(tab => list.appendChild(createTabRow(tab)));
  }
}

function createTabRow(tab) {
  const row = document.createElement('div');
  row.className = `tab-row ${tab.state}`;

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = tab.state === 'sleeping' ? '💤' : '🟢';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || '(untitled)';
  title.title = tab.url || '';

  row.appendChild(badge);
  row.appendChild(title);

  row.addEventListener('click', () => {
    chrome.tabs.update(parseInt(tab.id), { active: true });
  });

  return row;
}

document.addEventListener('DOMContentLoaded', () => {
  render();
  setInterval(render, 2000);
});
