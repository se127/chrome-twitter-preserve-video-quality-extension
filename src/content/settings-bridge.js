/**
 * Isolated-world bridge.
 *
 * The popup cannot touch x.com's localStorage (different origin), and the MAIN-world
 * script cannot use chrome.storage. This script connects the two: it reads the
 * extension's real settings and mirrors them into page localStorage, and it listens
 * for changes so a new choice takes effect on the next page load.
 *
 * This file deliberately does NOT depend on ../common/i18n.js. See normalizeLocale.
 */

const QUALITY_KEY = 'quality';
const LOCALE_KEY = 'locale';

const PAGE_QUALITY_KEY = 'xvq:quality';
const PAGE_LOCALE_KEY = 'xvq:locale';

// Same-document signal from the bridge to the MAIN world. See mirror().
const PAGE_EVENT = 'xvq:settings-mirrored';

// Which locales exist. Duplicated from i18n.js on purpose: mirroring the locale is this
// script's whole job, and when it used to take this from the shared module, a missing or
// unloaded i18n.js silently reduced normalizeLocale to "() => null" -- which made every
// Farsi choice mirror as English. Depending on a second file for one list is not worth
// that failure mode.
const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'fa'];

/** 'fa-IR', 'FA', 'fa' -> 'fa'. Anything unsupported (or a missing module) -> English. */
function normalizeLocale(raw) {
  if (typeof raw !== 'string') return null;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

function setPageValue(key, value) {
  if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
}

async function mirror() {
  const stored = await chrome.storage.local.get([QUALITY_KEY, LOCALE_KEY]);

  // English is the default; a stored choice always wins over it.
  const locale = normalizeLocale(stored[LOCALE_KEY]) ?? DEFAULT_LOCALE;

  setPageValue(PAGE_QUALITY_KEY, stored[QUALITY_KEY] || 'best');
  setPageValue(PAGE_LOCALE_KEY, locale);

  // Deliberately NOT touching document.documentElement.lang/dir. Doing so flipped all of
  // x.com to RTL, which is X's own UI to lay out -- this extension only ever renders its
  // own text (the badge), and sets dir/lang on that element where it belongs.

  // The page's `storage` event does NOT fire in the tab that made the change, and the
  // MAIN-world badge in this same tab is what needs to know. Both worlds share the DOM
  // even though they do not share JS globals, so a custom event on document crosses over.
  document.dispatchEvent(new CustomEvent(PAGE_EVENT));
}

mirror();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[QUALITY_KEY] || changes[LOCALE_KEY]) mirror();
});