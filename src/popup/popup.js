const DEFAULTS = { quality: 'best', fallback: 'lowest' };

async function load() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const values = { ...DEFAULTS, ...stored };

  for (const name of ['quality', 'fallback']) {
    const input = document.querySelector(`input[name="${name}"][value="${values[name]}"]`);
    if (input) input.checked = true;
  }
}

document.addEventListener('change', (event) => {
  const { name, value } = event.target;
  if (name !== 'quality' && name !== 'fallback') return;
  chrome.storage.local.set({ [name]: value });
  showReloadButton();
});

// The MAIN-world script reads settings on load, so offer to reload open X tabs.
const button = document.getElementById('reload');

function showReloadButton() {
  button.hidden = false;
}

button.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: ['*://*.x.com/*', '*://*.twitter.com/*'] });
  await Promise.all(tabs.map((tab) => chrome.tabs.reload(tab.id)));
  window.close();
});

if (chrome.tabs && chrome.tabs.query) {
  chrome.tabs.query({ url: ['*://*.x.com/*', '*://*.twitter.com/*'] }).then((tabs) => {
    if (tabs.length) button.hidden = false;
  });
}

load();