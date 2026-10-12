/**
 * Isolated-world bridge.
 *
 * The popup cannot touch x.com's localStorage (different origin), and the MAIN-world
 * script cannot use chrome.storage. This script connects the two: it reads the
 * extension's real settings and mirrors them into page localStorage, and it listens
 * for changes so a new choice takes effect on the next page load.
 */

const QUALITY_KEY = 'quality';
const FALLBACK_KEY = 'fallback';

const PAGE_QUALITY_KEY = 'xvq:quality';
const PAGE_FALLBACK_KEY = 'xvq:fallback';

async function mirror() {
  const stored = await chrome.storage.local.get([QUALITY_KEY, FALLBACK_KEY]);

  const quality = stored[QUALITY_KEY] || 'best';
  const fallback = stored[FALLBACK_KEY] || 'lowest';

  if (localStorage.getItem(PAGE_QUALITY_KEY) !== quality) {
    localStorage.setItem(PAGE_QUALITY_KEY, quality);
  }
  if (localStorage.getItem(PAGE_FALLBACK_KEY) !== fallback) {
    localStorage.setItem(PAGE_FALLBACK_KEY, fallback);
  }
}

mirror();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[QUALITY_KEY] || changes[FALLBACK_KEY]) mirror();
});