/**
 * End-to-end check of the setting pipeline:
 *   popup (chrome.storage.local) -> bridge (mirrors into page localStorage)
 *   -> MAIN-world rewriter (reads page localStorage)
 *
 * This exists because the popup visibly changed language while the page's
 * xvq:locale stayed at "en", and neither unit test could see the gap: both
 * tested their own side in isolation. The three pieces are wired together here
 * against a fake chrome.storage, so a break anywhere in the chain is visible.
 *
 * Run: bun test-sync.js
 */

import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`
  );
}

// --- fake chrome.storage.local ------------------------------------------------------

function makeStorage(initial = {}) {
  const data = { ...initial };
  const listeners = [];

  return {
    data,
    local: {
      async get(keys) {
        const out = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (key in data) out[key] = data[key];
        }
        return out;
      },
      async set(patch) {
        const changes = {};
        for (const [k, v] of Object.entries(patch)) {
          changes[k] = { oldValue: data[k], newValue: v };
          data[k] = v;
        }
        // Chrome fires onChanged in the same tick-ish; synchronous is fine here.
        for (const fn of listeners) fn(changes, 'local');
      },
    },
    onChanged: {
      addListener(fn) {
        listeners.push(fn);
      },
    },
  };
}

// --- fake page localStorage ---------------------------------------------------------

function makeLocalStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

// --- load the bridge against the fakes ---------------------------------------------

const i18nSrc = read('./src/common/i18n.js');
const bridgeSrc = read('./src/content/settings-bridge.js');

/**
 * The bridge is written as a top-level script. Give it a realm containing
 * chrome.storage, localStorage and a document stub, then run it and hand back
 * the page-side storage so we can inspect what it mirrored.
 */
function loadBridge({ storage, pageStorage }) {
  const events = [];

  // The scripts are top-level and refer to bare `chrome`, `localStorage`, `document`,
  // `globalThis` and `CustomEvent`, so pass each in as a parameter rather than relying
  // on the host realm. i18n.js publishes onto the globalThis it is given, which is how
  // the bridge finds the real module instead of its English fallback.
  const fakeGlobal = {};
  const documentStub = {
    documentElement: { lang: '', dir: '' },
    dispatchEvent: (e) => events.push(e.type),
  };
  const CustomEventStub = class {
    constructor(type) {
      this.type = type;
    }
  };

  const run = new Function(
    'chrome',
    'localStorage',
    'document',
    'CustomEvent',
    'globalThis',
    `${i18nSrc}\n${bridgeSrc}`
  );

  run({ storage }, pageStorage, documentStub, CustomEventStub, fakeGlobal);

  return { events, documentEl: documentStub.documentElement, global: fakeGlobal };
}

const tick = () => new Promise((r) => setImmediate(r));

// --- the actual scenario ------------------------------------------------------------
// Stored locale is "fa" (the user picked Farsi). On a fresh page load the bridge must
// mirror that into page localStorage so the badge can read it.

const storage = makeStorage({ quality: '240', locale: 'fa' });
const pageStorage = makeLocalStorage({});

const { documentEl } = loadBridge({ storage, pageStorage });
await tick();

console.log('--- bridge mirrors stored settings into the page ---');
check('stored locale reaches page localStorage', pageStorage.data['xvq:locale'], 'fa');
check('stored quality reaches page localStorage', pageStorage.data['xvq:quality'], '240');
// x.com's own layout is not ours to change: the bridge must leave <html> alone.
check('html lang is left untouched', documentEl.lang, '');
check('html dir is left untouched', documentEl.dir, '');

console.log('\n--- a language change propagates live ---');
// Same page, no reload: the popup writes, and the already-open page must follow.
await storage.local.set({ locale: 'en' });
await tick();
check('changing to English updates the page', pageStorage.data['xvq:locale'], 'en');
check('html dir is still untouched after a change', documentEl.dir, '');

await storage.local.set({ locale: 'fa' });
await tick();
check('changing back to Farsi updates the page', pageStorage.data['xvq:locale'], 'fa');

console.log('\n--- defaults when nothing is stored ---');
const freshStorage = makeStorage({});
const freshPage = makeLocalStorage({});
loadBridge({ storage: freshStorage, pageStorage: freshPage });
await tick();
check('no stored locale defaults to English', freshPage.data['xvq:locale'], 'en');
check('no stored quality defaults to best', freshPage.data['xvq:quality'], 'best');

// --- the popup side ---------------------------------------------------------------
// Run popup.js's real change handler against a stub DOM and see what it writes to
// chrome.storage.local. A stub element whose `name`/`value` we set simulates the radio
// the user clicked.

console.log('\n--- the bridge must stand alone (no i18n.js) ---');
// The reported bug: picking Farsi mirrored "en". The bridge used to take normalizeLocale
// from the shared i18n module, and a module that failed to load silently reduced it to
// "() => null" -- pinning every choice to English while quality kept working, because
// quality never calls into i18n at all.
check('bridge no longer references XVQ_I18N', /XVQ_I18N/.test(bridgeSrc), false);
check('bridge no longer references I18N.', /I18N\./.test(bridgeSrc), false);
check('bridge defines its own normalizeLocale', /function normalizeLocale\(raw\)/.test(bridgeSrc), true);
check('bridge knows both locales', /SUPPORTED_LOCALES = \['en', 'fa'\]/.test(bridgeSrc), true);
check('bridge carries no direction table', /DIRECTIONS/.test(bridgeSrc), false);

/** Run the bridge with no i18n.js in scope at all -- the failing scenario. */
function runBridgeAlone(storage, pageStorage) {
  const documentStub = { documentElement: { lang: '', dir: '' }, dispatchEvent() {} };
  const CustomEventStub = class {
    constructor(type) {
      this.type = type;
    }
  };
  const run = new Function('chrome', 'localStorage', 'document', 'CustomEvent', bridgeSrc);
  run({ storage }, pageStorage, documentStub, CustomEventStub, {});
  return documentStub.documentElement;
}

const aloneFarsi = makeLocalStorage({});
const aloneDoc = runBridgeAlone(makeStorage({ quality: '720', locale: 'fa' }), aloneFarsi);
await tick();
check('Farsi mirrors with no i18n module present', aloneFarsi.data['xvq:locale'], 'fa');
check('html dir untouched with no i18n module present', aloneDoc.dir, '');
check('quality mirrors with no i18n module present', aloneFarsi.data['xvq:quality'], '720');

const aloneJunk = makeLocalStorage({});
runBridgeAlone(makeStorage({ locale: 'de' }), aloneJunk);
await tick();
check('an unsupported locale still falls back to English', aloneJunk.data['xvq:locale'], 'en');

console.log('\n--- popup writes the choice to chrome.storage ---');

function loadPopup({ storage }) {
  const inputs = new Map();

  const makeInput = (name, value) => ({ type: 'radio', name, value, checked: false, parentElement: null });

  const container = (id) => ({
    id,
    children: [],
    replaceChildren() {
      this.children = [];
    },
    append(node) {
      this.children.push(node);
    },
  });

  const nodes = {
    heading: { textContent: '' },
    hint: { textContent: '' },
    reload: { textContent: '', hidden: true, addEventListener() {} },
    qualityLegend: { textContent: '' },
    fallbackLegend: { textContent: '' },
    enabledLegend: { textContent: '' },
    languageLegend: { textContent: '' },
    qualityOptions: container('qualityOptions'),
    languageOptions: container('languageOptions'),
  };

  const documentStub = {
    title: '',
    documentElement: { lang: '', dir: '' },
    getElementById: (id) => nodes[id],
    querySelectorAll: () => [],
    // The popup builds its radios through createElement; the elements need to behave
    // enough to hold a label span and find its parent, which render() walks.
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      textContent: '',
      children: [],
      append(...kids) {
        this.children.push(...kids);
      },
      replaceChildren() {
        this.children = [];
      },
      querySelector: () => ({ textContent: '' }),
    }),
    addEventListener: (type, fn) => {
      if (type === 'change') documentStub.__change = fn;
    },
  };

  const run = new Function(
    'chrome',
    'document',
    'window',
    'globalThis',
    `${i18nSrc}\n${read('./src/popup/popup.js')}`
  );

  // popup.js reads a bare `XVQ_I18N` global (it destructures it at the top), which is
  // what a bare global reference needs in the browser. Pass this realm's real
  // globalThis so that lookup resolves the same way.
  run({ storage, tabs: { query: async () => [] } }, documentStub, { close() {} }, globalThis);

  return { documentStub, nodes, makeInput };
}

const popStorage = makeStorage({});
const popup = loadPopup({ storage: popStorage });
await tick();

// The user clicks the "Farsi" radio.
popup.documentStub.__change({ target: popup.makeInput('language', 'fa') });
await tick();

check('popup stores the chosen locale', popStorage.data.locale, 'fa');
check('popup did not store it under "language"', popStorage.data.language, undefined);

console.log('\n--- and the bridge picks it straight up ---');
const bridgePage = makeLocalStorage({});
loadBridge({ storage: popStorage, pageStorage: bridgePage });
await tick();
check('page sees Farsi through the real popup write', bridgePage.data['xvq:locale'], 'fa');

console.log(`\n${failed ? `${failed} FAILURES` : 'all tests pass'}`);
process.exit(failed ? 1 : 0);