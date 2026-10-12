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
function loadBridge({ storage, pageStorage, window: windowArg }) {
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
    'window',
    `${i18nSrc}\n${bridgeSrc}`
  );

  // The bridge listens for page `storage` events to push outside edits back up. Default
  // to a listener-less window so the existing cases keep exercising only the mirror path.
  run({ storage }, pageStorage, documentStub, CustomEventStub, fakeGlobal, windowArg ?? { addEventListener() {} });

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
  const run = new Function('chrome', 'localStorage', 'document', 'CustomEvent', 'window', bridgeSrc);
  run({ storage }, pageStorage, documentStub, CustomEventStub, { addEventListener() {} }, {});
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

// --- the reverse direction: page localStorage -> chrome.storage -> open popup ----------
// The pipeline was one-way, so editing the page's localStorage left the popup showing
// the old choice. The bridge must push the edit up, and the popup must follow it live.

console.log('\n--- editing page localStorage reaches chrome.storage ---');

/** Simulate devtools writing a key on the page: same-document writes from setPageValue
 *  would not raise this, which is exactly why only outside writers are heard. */
function editPageStorage(pageStorage, windowStub, key, newValue) {
  if (newValue === null) delete pageStorage.data[key];
  else pageStorage.data[key] = newValue;
  for (const fn of windowStub.__storageListeners) fn({ key, newValue });
}

const revStorage = makeStorage({ quality: '480', locale: 'en' });
const revPage = makeLocalStorage({ 'xvq:quality': '480', 'xvq:locale': 'en' });
const windowListeners = [];
const windowStub = {
  __storageListeners: windowListeners,
  addEventListener: (type, fn) => {
    if (type === 'storage') windowListeners.push(fn);
  },
};

loadBridge({ storage: revStorage, pageStorage: revPage, window: windowStub });
await tick();
check('bridge listens for page storage events', windowListeners.length, 1);

editPageStorage(revPage, windowStub, 'xvq:quality', '1080');
await tick();
check('a page quality edit reaches chrome.storage', revStorage.data.quality, '1080');

editPageStorage(revPage, windowStub, 'xvq:locale', 'fa');
await tick();
check('a page locale edit reaches chrome.storage', revStorage.data.locale, 'fa');

console.log('\n--- bad hand-edits are rejected ---');
editPageStorage(revPage, windowStub, 'xvq:quality', 'banana');
await tick();
check('an unknown quality is not persisted', revStorage.data.quality, '1080');

editPageStorage(revPage, windowStub, 'xvq:locale', 'de');
await tick();
check('an unsupported locale is not persisted', revStorage.data.locale, 'fa');

editPageStorage(revPage, windowStub, 'xvq:quality', null);
await tick();
check('a removed key is not persisted as null', revStorage.data.quality, '1080');

editPageStorage(revPage, windowStub, 'somethingElse', 'x');
await tick();
check('an unrelated key is ignored', Object.keys(revStorage.data).sort().join(','), 'locale,quality');

console.log('\n--- mirror() and the storage listener do not loop ---');
// mirror() writes to the page; a same-document write raises no storage event, so the
// reverse listener must not bounce the value back and forth.
const loopStorage = makeStorage({ quality: '720', locale: 'fa' });
const loopPage = makeLocalStorage({});
const loopListeners = [];
let loopDispatches = 0;
const loopWindow = {
  addEventListener: (type, fn) => {
    if (type === 'storage') loopListeners.push(fn);
  },
};
const loopDoc = {
  documentElement: { lang: '', dir: '' },
  dispatchEvent: () => {
    loopDispatches++;
  },
};
const loopRun = new Function(
  'chrome',
  'localStorage',
  'document',
  'CustomEvent',
  'window',
  `${i18nSrc}\n${bridgeSrc}`
);
loopRun({ storage: loopStorage }, loopPage, loopDoc, class {
  constructor(type) {
    this.type = type;
  }
}, loopWindow);
await tick();
check('one mirror, no event storm', loopDispatches, 1);

console.log('\n--- an open popup follows a page edit ---');
const liveStorage = makeStorage({ quality: '480', locale: 'en' });
const livePopup = loadPopup({ storage: liveStorage });
await tick();

// One registration, so the popup is subscribed rather than only reading storage at load.
check('popup subscribes to storage changes', livePopup.storageChanges, 1);

const checkedQuality = () =>
  livePopup.allInputs()
    .filter((i) => i.name === 'quality' && i.checked)
    .map((i) => i.value);
const checkedLanguage = () =>
  livePopup.allInputs()
    .filter((i) => i.name === 'language' && i.checked)
    .map((i) => i.value);

check('popup opens on the stored quality', checkedQuality(), ['480']);
check('popup opens on the stored language', checkedLanguage(), ['en']);

// Something else changes quality -- here the bridge pushing a page edit up.
await liveStorage.local.set({ quality: '2160' });
await tick();
check('an outside quality change moves the popup radio', checkedQuality(), ['2160']);
check('the reload prompt appears for an outside quality change', livePopup.nodes.reload.hidden, false);

// A quality-only change must leave the language alone rather than snapping to English.
livePopup.documentStub.__change({ target: livePopup.makeInput('language', 'fa') });
await tick();
check('picking Farsi in the popup checks its radio', checkedLanguage(), ['fa']);

await liveStorage.local.set({ quality: '1080' });
await tick();
check('a quality-only change keeps Farsi', checkedLanguage(), ['fa']);
check('a quality-only change shows the new quality', checkedQuality(), ['1080']);

// And the round trip: a page edit travels all the way to the popup.
const rtStorage = makeStorage({ quality: '480', locale: 'en' });
const rtPage = makeLocalStorage({ 'xvq:quality': '480', 'xvq:locale': 'en' });
const rtWindow = { addEventListener: (type, fn) => { if (type === 'storage') (rtWindow.__l ??= []).push(fn); } };
loadBridge({ storage: rtStorage, pageStorage: rtPage, window: rtWindow });
const rtPopup = loadPopup({ storage: rtStorage });
await tick();
check('round trip opens on the stored values', rtStorage.data.quality, '480');

// What the bridge does when a page edit arrives.
for (const fn of rtWindow.__l) fn({ key: 'xvq:quality', newValue: '720' });
await tick();
check('page edit reaches chrome.storage', rtStorage.data.quality, '720');

const rtChecked = () =>
  rtPopup
    .allInputs()
    .filter((i) => i.name === 'quality' && i.checked)
    .map((i) => i.value);
check('page edit is reflected in the open popup', rtChecked(), ['720']);

console.log('\n--- popup writes the choice to chrome.storage ---');

function loadPopup({ storage }) {
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

  // Real-ish elements so render() can walk the built radios: it looks inputs up with
  // `#<group>Options input` and then writes through `input.parentElement`. Without this
  // the query returns nothing and a popup that never re-renders looks identical to one
  // that does -- which is exactly the bug this file exists to catch.
  function makeElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      textContent: '',
      children: [],
      parentElement: null,
      append(...kids) {
        // render() walks input.parentElement.querySelector('span'), so the tree has to
        // actually link back to its parent.
        for (const kid of kids) kid.parentElement = this;
        this.children.push(...kids);
      },
      replaceChildren() {
        this.children = [];
      },
      querySelector(sel) {
        const want = sel.toUpperCase();
        return this.children.find((c) => c.tagName === want) ?? makeElement('span');
      },
      get next() {
        return null;
      },
    };
    return el;
  }

  const allInputs = () => {
    const out = [];
    for (const key of ['qualityOptions', 'languageOptions']) {
      for (const label of nodes[key].children) {
        for (const kid of label.children) {
          if (kid.tagName === 'INPUT') out.push(kid);
        }
      }
    }
    return out;
  };

  const documentStub = {
    title: '',
    documentElement: { lang: '', dir: '' },
    getElementById: (id) => nodes[id],
    querySelectorAll: (sel) => {
      const group = /^#(\w+)Options input$/.exec(sel)?.[1];
      if (!group) return [];
      return allInputs().filter((i) => i.name === group);
    },
    createElement: makeElement,
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
  //
  // Count storage subscriptions so a test can tell "the popup never listens" from
  // "the popup listened and ignored it".
  const chromeStub = { tabs: { query: async () => [] } };
  let storageChanges = 0;
  chromeStub.storage = {
    local: storage.local,
    onChanged: {
      addListener(fn) {
        storageChanges++;
        storage.onChanged.addListener(fn);
      },
    },
  };

  run(chromeStub, documentStub, { close() {} }, globalThis);

  return {
    documentStub,
    nodes,
    makeInput,
    allInputs,
    get storageChanges() {
      return storageChanges;
    },
  };
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