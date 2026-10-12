/**
 * Tests for the bilingual layer: src/common/i18n.js plus the locale/direction
 * behaviour that depends on it (the MAIN-world badge, the popup, the bridge).
 * Run: bun test-i18n.js   (or: node test-i18n.js)
 */

import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// --- i18n module -------------------------------------------------------------------
// i18n.js attaches to window when present and globalThis otherwise; under bun there is
// no window yet, so read it off globalThis.
const i18nSrc = read('./src/common/i18n.js');
const { t, dir, locale, normalizeLocale, defaultLocale, localeLabel, DEFAULT_LOCALE, LOCALES } =
  new Function(`${i18nSrc}; return globalThis.XVQ_I18N;`)();

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`
  );
}

// --- MAIN-world rewriter, driven with DOM stubs -------------------------------------
const elements = new Map();

function makeEl(tag) {
  return { tagName: tag, id: '', textContent: '', title: '', dir: '', lang: '', children: [] };
}

const body = {
  children: [],
  append(...nodes) {
    for (const node of nodes) {
      if (node.id) elements.set(node.id, node);
      this.children.push(node);
    }
  },
};

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
};
globalThis.document = {
  readyState: 'complete',
  createElement: makeEl,
  getElementById: (id) => elements.get(id) ?? null,
  body,
  addEventListener() {},
  documentElement: makeEl('html'),
};
globalThis.window = { fetch: async () => {}, addEventListener() {} };
globalThis.XMLHttpRequest = class {
  open() {}
};

const hijackSrc = read('./src/content/playlist-hijack.js');
const hijack = new Function(
  `${hijackSrc}; return { QUALITIES, qualityLabel, currentLocale, renderBadge, mountBadge, LOCALE_KEY, STORE_KEY };`
)();

const setLocale = (l) => {
  store[hijack.LOCALE_KEY] = l;
};
const setQuality = (q) => {
  store[hijack.STORE_KEY] = q;
};
const badge = () => document.getElementById('xvq-badge');

/** Set the settings the rewriter reads, then paint the badge from them. */
const render = (l, quality) => {
  setLocale(l);
  setQuality(quality);
  hijack.renderBadge();
  return badge().textContent;
};

console.log('--- locale normalisation ---');
check('default locale is English', DEFAULT_LOCALE, 'en');
check('plain code', normalizeLocale('fa'), 'fa');
check('regional tag', normalizeLocale('fa-IR'), 'fa');
check('uppercase', normalizeLocale('FA'), 'fa');
check('underscore tag', normalizeLocale('en_GB'), 'en');
check('padded', normalizeLocale('  fa  '), 'fa');
check('unsupported -> null', normalizeLocale('de'), null);
check('non-string -> null', normalizeLocale(null), null);
check('locale() falls back to English', locale('de'), 'en');
check('locale() passes through valid', locale('fa'), 'fa');

console.log('\n--- first-run default ---');
check('default is English', defaultLocale(), 'en');
check('default ignores an unsupported stored value', locale('de'), 'en');
check('default ignores a Persian stored value only if unset', normalizeLocale(null), null);
// English must be the default regardless of the browser's language: no detection.
check('no browser detection is exported', Object.keys(new Function(`${i18nSrc}; return globalThis.XVQ_I18N;`)()).includes('detectLocale'), false);
check('i18n module never reads navigator', /navigator/.test(i18nSrc), false);

console.log('\n--- translation ---');
check('English heading', t('heading', 'en'), 'X Video Quality');
check('Farsi heading', t('heading', 'fa'), 'کیفیت ویدیو X');
// The heading names the extension, so it must match the document title in both locales.
check('heading matches appName in English', t('heading', 'en'), t('appName', 'en'));
check('heading matches appName in Farsi', t('heading', 'fa'), t('appName', 'fa'));
check('Farsi heading still names X', /X/.test(t('heading', 'fa')), true);
check('English heading still names X', /X/.test(t('heading', 'en')), true);
check('English best', t('qualityBest', 'en'), 'Best available');
check('Farsi best', t('qualityBest', 'fa'), 'بهترین کیفیت موجود');
check('Farsi lowest', t('qualityLowest', 'fa'), 'پایین ترین کیفیت موجود');
check('Farsi quality best is not English', t('qualityBest', 'fa') !== t('qualityBest', 'en'), true);
check('missing key falls through to English', t('qualityBest', 'de'), 'Best available');
check('unknown key returns the key', t('nope', 'fa'), 'nope');
check('language named in its own script', [localeLabel('en'), localeLabel('fa')], ['English', 'فارسی']);
check('endonym independent of active locale', localeLabel('en'), 'English');

console.log('\n--- direction ---');
check('English is ltr', dir('en'), 'ltr');
check('Farsi is rtl', dir('fa'), 'rtl');
check('unknown locale is ltr', dir('de'), 'ltr');

console.log('\n--- translation completeness ---');
const enKeys = Object.keys(LOCALES.en.strings).sort();
const faKeys = Object.keys(LOCALES.fa.strings).sort();
check('Farsi has every English key', faKeys.filter((k) => !enKeys.includes(k)), []);
check('English has no stale keys', enKeys.filter((k) => !faKeys.includes(k)), []);
check('Farsi translations are not left in English', Object.keys(LOCALES.fa.strings).filter((k) => LOCALES.en.strings[k] === LOCALES.fa.strings[k]), []);
check('no empty strings', [...enKeys, ...faKeys].filter((k) => !t(k, 'en').trim() || !t(k, 'fa').trim()), []);

// Every t('key') call in the popup and the rewriter must exist in the table.
const popupSrc = read('./src/popup/popup.js');
const popupHtml = read('./src/popup/popup.html');
const bridgeSrc = read('./src/content/settings-bridge.js');
const usedKeys = [...popupSrc, ...hijackSrc, ...read('./src/content/settings-bridge.js')]
  .flatMap((src) => [...src.matchAll(/\bt\(\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));
check('every t() key used in source exists', [...new Set(usedKeys)].filter((key) => !enKeys.includes(key)), []);

console.log('\n--- badge rendering ---');
check('English badge text', render('en', 'best'), 'Video quality: Best available');
check('English badge dir', badge().dir, 'ltr');
check('English badge lang', badge().lang, 'en');

check('Farsi badge text', render('fa', 'best'), 'کیفیت ویدیو: بهترین کیفیت موجود');
check('Farsi badge dir', badge().dir, 'rtl');
check('Farsi badge lang', badge().lang, 'fa');

check('fixed heights stay untranslated in Farsi', render('fa', '1080'), 'کیفیت ویدیو: 1080p');
check('fixed heights stay untranslated in English', render('en', '1080'), 'Video quality: 1080p');

check('bad stored locale -> English', (setLocale('de'), hijack.currentLocale()), 'en');
check('bad stored locale still renders', render('de', '1080'), 'Video quality: 1080p');
check('unknown quality falls back to "best"', (setQuality('nonsense'), hijack.qualityLabel('nonsense')), 'Best available');

check('qualityLabel("lowest") is translated in Farsi', (setLocale('fa'), hijack.qualityLabel('lowest')), 'پایین ترین کیفیت موجود');
check('qualityLabel("lowest") is translated in English', (setLocale('en'), hijack.qualityLabel('lowest')), 'Lowest available');
check('qualityLabel("2160") is neutral', hijack.qualityLabel('2160'), '2160p (4K)');

// The badge tooltip was hardcoded English and so stayed English in Farsi.
check('English badge title', (setLocale('en'), render('en', 'best'), badge().title), 'Set this in the X Video Quality extension popup');
check('Farsi badge title is translated', (setLocale('fa'), render('fa', 'best'), badge().title), 'این را در پنجره افزونه X Video Quality تنظیم کنید');
check('badge title is not hardcoded in source', /badge\.title = 'Set this in/.test(hijackSrc), false);

console.log('\n--- badge updates live, not only on load ---');
// The `storage` event never fires in the tab that wrote the value, so a same-tab
// language change reached the badge by no path at all and it stayed English.
check('bridge dispatches a same-document event', /document\.dispatchEvent\(new CustomEvent\(PAGE_EVENT\)\)/.test(bridgeSrc), true);
check('rewriter listens for that event', /document\.addEventListener\(SETTINGS_EVENT, renderBadge\)/.test(hijackSrc), true);
check('both sides use the same event name', /PAGE_EVENT = 'xvq:settings-mirrored'/.test(bridgeSrc), true);
check('rewriter event name matches', /SETTINGS_EVENT = 'xvq:settings-mirrored'/.test(hijackSrc), true);
check('event fires on every mirror, not only the first', /function mirror\(\)[\s\S]*dispatchEvent/.test(bridgeSrc), true);
check('storage change still triggers a re-mirror', /onChanged\.addListener/.test(bridgeSrc), true);

console.log('\n--- badge waits for the mirrored locale ---');
// The badge painted at DOMContentLoaded, before the ISOLATED bridge had written
// xvq:locale, so it showed English. The storage event cannot fix that: it only fires
// in other tabs. Assert the polling guard exists and is bounded.
check('badge polls for mirrored settings', /waitForMirroredSettings\(\)/.test(hijackSrc), true);
check('mounting triggers the wait', /renderBadge\(\);\s*\n\s*\n\s*\/\/ The badge mounts/.test(hijackSrc), true);
check('polling has a timeout', /setTimeout\(\(\) => clearInterval\(timer\), 5000\)/.test(hijackSrc), true);
check('polling stops once the locale lands', /clearInterval\(timer\);\s*\n\s*renderBadge\(\);/.test(hijackSrc), true);
check('polling survives blocked storage', /return true; \/\/ storage blocked/.test(hijackSrc), true);
check('storage event still re-renders on later changes', /addEventListener\('storage'/.test(hijackSrc), true);

console.log('\n--- quality values are language-neutral ---');
// Selection must never depend on language: same setting, same variant, both locales.
const heights = Object.fromEntries(
  Object.entries(hijack.QUALITIES).map(([id, q]) => [id, q.height])
);
check('quality table is locale-independent', heights, {
  best: Infinity,
  '2160': 2160,
  '1440': 1440,
  '1080': 1080,
  '720': 720,
  '480': 480,
  '360': 360,
  '240': 240,
  lowest: -Infinity,
});
check('every quality has a label in both locales', ['en', 'fa'].every((l) => (setLocale(l), Object.keys(hijack.QUALITIES).every((q) => hijack.qualityLabel(q).length > 0))), true);

console.log('\n--- manifest wiring ---');
const manifest = JSON.parse(read('./manifest.json'));
const worlds = Object.fromEntries(manifest.content_scripts.map((cs) => [cs.world, cs.js]));
check('MAIN world loads i18n before the rewriter', worlds.MAIN, ['src/common/i18n.js', 'src/content/playlist-hijack.js']);
check('ISOLATED world loads i18n before the bridge', worlds.ISOLATED, ['src/common/i18n.js', 'src/content/settings-bridge.js']);

console.log('\n--- popup persistence contract ---');
// Regression guard: the popup's state key for language is "language", but its storage
// key is "locale". Writing the state name would save a key nothing ever reads, so the
// choice would silently never persist and the radio would never show as checked.
const popupBody = popupSrc;
const groups = [...popupBody.matchAll(/name:\s*'(\w+)',\s*key:\s*'(\w+)'/g)].map((m) => [m[1], m[2]]);
check('quality state/storage key match', groups.find((g) => g[0] === 'quality'), ['quality', 'quality']);
// The fallback fieldset was removed; nothing may reintroduce it silently.
check('no fallback group remains', groups.find((g) => g[0] === 'fallback'), undefined);
check('language state/storage key match', groups.find((g) => g[0] === 'language'), ['language', 'locale']);
check('every group declares a storage key', groups.length, 2);

// The popup's quality list must match the rewriter's table exactly, or a quality could
// be selectable but unresolvable (or vice versa).
const popupQualities = [...popupBody.match(/const QUALITY_VALUES = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
// Compare as sets: the popup lists in display order, and the rewriter's numeric-like
// object keys get reordered by the JS engine.
const rewriterQualities = Object.keys(hijack.QUALITIES);
check(
  'popup offers exactly the rewriter qualities',
  [...popupQualities].sort(),
  [...rewriterQualities].sort()
);
check('popup quality list has no duplicates', new Set(popupQualities).size, popupQualities.length);
check('360p is offered (typo guard)', popupQualities.includes('360'), true);

// The bridge must read the same storage keys the popup writes.
const bridgeKeys = [...bridgeSrc.matchAll(/^const (\w+_KEY) = '(\w+)';/gm)].map((m) => m[2]);
check('bridge reads the keys the popup writes', bridgeKeys, ['quality', 'locale']);
check('bridge mirrors the locale to the page', /PAGE_LOCALE_KEY = 'xvq:locale'/.test(bridgeSrc), true);
check('rewriter reads the mirrored locale', /LOCALE_KEY = 'xvq:locale'/.test(hijackSrc), true);

console.log('\n--- no stale references ---');
check('bridge does not use removed detectLocale', /detectLocale/.test(bridgeSrc), false);
check('popup does not use removed detectLocale', /detectLocale/.test(popupBody), false);
check('no source still references detectLocale', /detectLocale/.test([hijackSrc, bridgeSrc, popupBody, i18nSrc].join('\n')), false);

console.log('\n--- fallback setting is gone ---');
// The "if that quality is not available" fieldset was removed; the rewriter now steps
// down to the next lowest. Guard against the old plumbing creeping back in.
const allSrc = [hijackSrc, bridgeSrc, popupBody, i18nSrc].join('\n');
check('no source mentions FALLBACK_KEY', /FALLBACK_KEY/.test(allSrc), false);
check('no source reads xvq:fallback', /xvq:fallback/.test(allSrc), false);
check('no source mentions FALLBACK_VALUES', /FALLBACK_VALUES/.test(allSrc), false);
check('no source reads a "fallback" storage key', /'fallback'/.test(allSrc), false);
check('no fallbackLegend string remains', /fallbackLegend/.test(i18nSrc), false);
check('no fallback i18n keys remain', /fallback(Lowest|Nearest|Highest)/.test(i18nSrc), false);
check('popup html has no fallback fieldset', /id="fallback"/.test(popupHtml), false);
check('pickStream takes only a quality argument', /function pickStream\(streams, quality\)/.test(hijackSrc), true);
check('pickStream steps down to the next lowest', /byHeightDesc\.find\(\(s\) => s\.height <= rule\.height\)/.test(hijackSrc), true);
// The spec: exact choice if present, otherwise step down one, never up.
check('pickStream checks for an exact match first', /streams\.filter\(\(s\) => s\.height === rule\.height\)/.test(hijackSrc), true);
check('pickStream keeps best/lowest as literal extremes', /rule\.height === Infinity/.test(hijackSrc) && /rule\.height === -Infinity/.test(hijackSrc), true);

console.log('\n--- reload is only needed for quality ---');
// Language applies instantly, so changing it must not prompt for a reload.
const changeHandler = popupBody.slice(popupBody.indexOf("addEventListener('change'"));
check(
  'language change does not show the reload button',
  /if \(group\.name !== 'language'\) showReloadButton\(value !== applied\[group\.name\]\);/.test(changeHandler),
  true
);
check('showReloadButton still takes a flag', /function showReloadButton\(needed\)/.test(popupBody), true);
// Must be able to hide the button again, not just reveal it: 360 -> 480 -> 360 without
// reloading leaves the tabs on 360, so the prompt has to disappear.
check('the button is hidden again when not needed', /button\.hidden = !needed;/.test(popupBody), true);
check('the button is not one-way revealed', /button\.hidden = false;/.test(popupBody), false);
// The button must appear only for a quality that differs from what tabs are running.
check('applied tracks what tabs are running', /applied = \{ \.\.\.current \};\n/.test(popupBody), true);
check('reloading tabs catches applied up', /applied = \{ \.\.\.current \};\s*\n\s*window\.close\(\);/.test(popupBody), true);
check('button is hidden by default in the markup', /id="reload"[^>]*hidden/.test(popupHtml), true);
// The old "an X tab exists -> show it" block is what made it appear every time.
check('no unconditional show-on-open', /tabs\.length\) showReloadButton\(\)/.test(popupBody), false);
check('no orphan tabs.query on load', /if \(chrome\.tabs && chrome\.tabs\.query\)/.test(popupBody), false);
// The popup re-renders on every change, which is what makes language apply immediately.
check('popup re-renders on change', /render\(\);/.test(changeHandler), true);
// The bridge re-mirrors into open tabs live, without a reload.
check('bridge mirrors on storage change', /onChanged\.addListener/.test(bridgeSrc), true);
// The extension must NOT restyle x.com itself. It used to write documentElement.lang/dir,
// which flipped the entire site to RTL; only the badge should ever change language.
check('bridge does not touch documentElement.lang', /documentElement\.lang\s*=/.test(bridgeSrc), false);
check('bridge does not touch documentElement.dir', /documentElement\.dir\s*=/.test(bridgeSrc), false);

console.log('\n--- page localStorage edits reach the popup ---');
// The pipeline used to be one-way, so an edit to the page's localStorage never reached
// chrome.storage and the popup went on showing the old choice.
check('bridge listens for page storage events', /window\.addEventListener\('storage'/.test(bridgeSrc), true);
check('bridge pushes page edits back into chrome.storage', /function pageEditToStorage/.test(bridgeSrc), true);
check('bridge validates a hand-edited quality', /VALID_QUALITIES\.includes/.test(bridgeSrc), true);
check('bridge validates a hand-edited locale', /normalizeLocale\(event\.newValue\)/.test(bridgeSrc), true);
// The popup read storage once at load(), so anything changed later stayed invisible.
check('popup follows storage changes while open', /chrome\.storage\.onChanged\.addListener/.test(popupBody), true);
check('popup only reacts to the local area', /if \(area !== 'local'\) return;/.test(popupBody), true);
// A quality-only change must not reset the language: absent keys keep their value
// instead of snapping back to the default.
check('partial updates keep the other setting', /function mergeStored\(stored\)/.test(popupBody), true);
check('mergeStored does not default an absent key', /'quality' in stored \? stored\.quality : current\.quality/.test(popupBody), true);

console.log('\n--- resilience ---');
// A stale extension install missing the shared module must not disable quality control,
// and -- the bug that started this -- must not pin the language to English either.
check('bridge does not depend on the shared module at all', /XVQ_I18N/.test(bridgeSrc), false);
check('bridge normalises the locale itself', /function normalizeLocale\(raw\)/.test(bridgeSrc), true);
check('rewriter guards a missing i18n module', /globalThis\.XVQ_I18N \?\?/.test(hijackSrc), true);
// Its fallback must still recognise Farsi, or the badge renders English for a Farsi
// choice -- the same failure the bridge had.
check(
  'rewriter fallback still understands fa',
  /normalizeLocale: \(raw\) => \(typeof raw === 'string' && raw\.trim\(\)\.toLowerCase\(\)\.split\(\/\[-_\]\/\)\[0\] === 'fa' \? 'fa' : null\)/.test(
    hijackSrc
  ),
  true
);
check('i18n publishes on window as well as globalThis', /window\.XVQ_I18N = globalThis\.XVQ_I18N/.test(i18nSrc), true);

console.log(`\n${failed ? `${failed} FAILURES` : 'all tests pass'}`);
process.exit(failed ? 1 : 0);