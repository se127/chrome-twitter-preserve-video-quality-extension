const { t, locale: resolveLocale, normalizeLocale, defaultLocale, dir, DEFAULT_LOCALE } = XVQ_I18N;

const DEFAULTS = { quality: 'best' };

// Numeric quality values are language-neutral; only the two extremes carry text.
const QUALITY_VALUES = ['best', '2160', '1440', '1080', '720', '480', '360', '240', 'lowest'];
const LANGUAGE_VALUES = ['en', 'fa'];

const LABELS = {
  quality: {
    best: 'qualityBest',
    '2160': '2160p (4K)',
    '1440': '1440p',
    '1080': '1080p',
    '720': '720p',
    '480': '480p',
    '360': '360p',
    '240': '240p',
    lowest: 'qualityLowest',
  },
  // Each language is named in its own script, so these ignore the active locale.
  language: {
    en: 'languageEnglish',
    fa: 'languageFarsi',
  },
};

// `name` is the internal state key; `key` is the chrome.storage.local key. These are
// NOT the same for language (state "language", stored key "locale") -- the bridge reads
// "locale", so writing "language" here would silently never persist.
const GROUPS = [
  { name: 'quality', key: 'quality', legend: 'qualityLegend', values: QUALITY_VALUES },
  { name: 'language', key: 'locale', legend: 'languageLegend', values: LANGUAGE_VALUES },
];

const byName = (name) => GROUPS.find((group) => group.name === name);

const button = document.getElementById('reload');

// The language in effect right now, resolved once so every render agrees with it.
let currentLocale = defaultLocale();
let current = { ...DEFAULTS, language: currentLocale };

// What the already-open tabs are running with, as opposed to what is picked in the
// popup. They differ only while a quality change is waiting on a reload.
let applied = { ...current };

function label(group, value) {
  return t(LABELS[group.name][value], currentLocale);
}

// Build the radios once, then only re-render text and checked state afterwards.
function buildOptions(group) {
  const container = document.getElementById(`${group.name}Options`);
  container.replaceChildren();

  for (const value of group.values) {
    const labelEl = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = group.name;
    input.value = value;

    const span = document.createElement('span');
    span.textContent = label(group, value);

    labelEl.append(input, span);
    container.append(labelEl);
  }
}

function render() {
  document.title = t('appName', currentLocale);
  document.documentElement.lang = currentLocale;
  document.documentElement.dir = dir(currentLocale);

  document.getElementById('heading').textContent = t('heading', currentLocale);
  document.getElementById('hint').textContent = t('hint', currentLocale);
  button.textContent = t('reloadTabs', currentLocale);

  for (const group of GROUPS) {
    document.getElementById(group.legend).textContent = t(group.legend, currentLocale);

    for (const input of document.querySelectorAll(`#${group.name}Options input`)) {
      input.parentElement.querySelector('span').textContent = label(group, input.value);
      input.checked = input.value === current[group.name];
    }
  }
}

async function load() {
  const keys = GROUPS.map((group) => group.key);
  const stored = await chrome.storage.local.get(keys);

  const storedLocale = normalizeLocale(stored.locale);
  currentLocale = storedLocale ?? DEFAULT_LOCALE;

  current = {
    quality: stored.quality ?? DEFAULTS.quality,
    language: currentLocale,
  };

  // What the already-open tabs are actually running with. Starts equal to `current`,
  // since these are the values the pages were loaded with.
  applied = { ...current };

  for (const group of GROUPS) buildOptions(group);
  render();
}

document.addEventListener('change', (event) => {
  const { name, value } = event.target;
  const group = byName(name);
  if (!group) return;

  if (group.name === 'language') currentLocale = resolveLocale(value);
  current[group.name] = group.name === 'language' ? currentLocale : value;

  // Write to the group's storage key -- for language that is "locale", not "language".
  chrome.storage.local.set({ [group.key]: current[group.name] });

  render();

  // Language is the extension's own: the popup re-renders here and the bridge pushes
  // lang/dir into open tabs live, so it applies immediately.
  //
  // Quality is read by the MAIN-world script as each playlist loads, so a reload is
  // needed -- but only while the choice differs from what the open tabs are already
  // using. This has to be a toggle, not a one-way reveal: changing 360 -> 480 -> 360
  // without reloading leaves the tabs on 360, so the prompt must disappear again.
  if (group.name !== 'language') showReloadButton(value !== applied[group.name]);
});

// The MAIN-world script reads settings on load, so offer to reload open X tabs.
function showReloadButton(needed) {
  button.hidden = !needed;
}

button.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: ['*://*.x.com/*', '*://*.twitter.com/*'] });
  await Promise.all(tabs.map((tab) => chrome.tabs.reload(tab.id)));
  // The tabs now run what is picked, so nothing is left waiting on a reload.
  applied = { ...current };
  window.close();
});

// Deliberately no "show on open if an X tab exists" check: opening the popup after
// choosing a quality shows nothing until that choice differs from what is in use.
load();
