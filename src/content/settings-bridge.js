/**
 * Isolated-world bridge.
 *
 * The popup cannot touch x.com's localStorage (different origin), and the MAIN-world
 * script cannot use chrome.storage. This script connects the two: it reads the
 * extension's real settings and mirrors them into page localStorage, and it listens
 * for changes so a new choice takes effect on the next page load.
 */

const QUALITY_KEY = 'quality';
const LOCALE_KEY = 'locale';

const PAGE_QUALITY_KEY = 'xvq:quality';
const PAGE_LOCALE_KEY = 'xvq:locale';

// Mirroring quality is this script's core job, so it must survive the shared
// i18n module being absent (e.g. a stale extension that predates it). Degrade to English
// rather than throwing, otherwise a missing file would disable quality control entirely.
const I18N = globalThis.XVQ_I18N ?? {
  DEFAULT_LOCALE: 'en',
  normalizeLocale: () => null,
  dir: () => 'ltr',
};

function setPageValue(key, value) {
  if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
}

async function mirror() {
  const stored = await chrome.storage.local.get([QUALITY_KEY, LOCALE_KEY]);

  // English is the default; a stored choice always wins over it.
  const locale = I18N.normalizeLocale(stored[LOCALE_KEY]) ?? I18N.DEFAULT_LOCALE;

  setPageValue(PAGE_QUALITY_KEY, stored[QUALITY_KEY] || 'best');
  setPageValue(PAGE_LOCALE_KEY, locale);

  document.documentElement.lang = locale;
  document.documentElement.dir = I18N.dir(locale);
}

mirror();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[QUALITY_KEY] || changes[LOCALE_KEY]) mirror();
});