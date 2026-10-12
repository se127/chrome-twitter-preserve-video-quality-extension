/**
 * Shared bilingual strings (English / Farsi).
 *
 * Loaded in all three worlds -- the MAIN-world playlist rewriter, the ISOLATED-world
 * settings bridge, and the popup -- so a locale renders identically everywhere.
 * Deliberately free of both chrome.* and DOM access: each caller knows where the
 * setting lives (chrome.storage or page localStorage), this file only knows the words.
 */
(function (root) {
  const DEFAULT_LOCALE = 'en';

  const LOCALES = {
    en: {
      label: 'English',
      dir: 'ltr',
      strings: {
        appName: 'X Video Quality',
        heading: 'X Video Quality',

        qualityLegend: 'Preferred quality',
        qualityBest: 'Best available',
        qualityLowest: 'Lowest available',

        languageLegend: 'Language',
        languageEnglish: 'English',
        languageFarsi: 'Farsi',

        hint: 'Applies on your next page load. Reload any open X tab to apply.',
        reloadTabs: 'Reload X tabs',
        badgePrefix: 'Video quality',
        badgeTitle: 'Set this in the X Video Quality extension popup',
      },
    },
    fa: {
      label: 'فارسی',
      dir: 'rtl',
      strings: {
        appName: 'کیفیت ویدیو X',
        heading: 'کیفیت ویدیو X',

        qualityLegend: 'کیفیت مورد نظر',
        qualityBest: 'بهترین کیفیت موجود',
        qualityLowest: 'پایین ترین کیفیت موجود',

        languageLegend: 'زبان',
        languageEnglish: 'انگلیسی',
        languageFarsi: 'فارسی',

        hint: 'در بارگذاری بعدی صفحه اعمال می‌شود. برای اعمال، هر تب باز X را دوباره بارگذاری کنید.',
        reloadTabs: 'بارگذاری دوباره تب‌های X',
        badgePrefix: 'کیفیت ویدیو',
        badgeTitle: 'این را در پنجره افزونه X Video Quality تنظیم کنید',
      },
    },
  };

  /** 'fa-IR', 'FA', 'fa' -> 'fa'. Anything unsupported -> null. */
  function normalizeLocale(raw) {
    if (typeof raw !== 'string') return null;
    const base = raw.trim().toLowerCase().split(/[-_]/)[0];
    return Object.prototype.hasOwnProperty.call(LOCALES, base) ? base : null;
  }

  /**
   * The language to show when the user has not chosen one. Deliberately English and
   * deliberately NOT the browser's language: a Persian browser must still get English
   * until they opt into Persian. A stored choice always wins over this.
   */
  function defaultLocale() {
    return DEFAULT_LOCALE;
  }

  function locale(raw) {
    return normalizeLocale(raw) || DEFAULT_LOCALE;
  }

  /** Unknown keys fall through to English, then to the key itself. */
  function t(key, rawLocale) {
    const chosen = LOCALES[locale(rawLocale)];
    return chosen.strings[key] ?? LOCALES[DEFAULT_LOCALE].strings[key] ?? key;
  }

  function dir(rawLocale) {
    return LOCALES[locale(rawLocale)].dir;
  }

  /** Native endonym, so a language is always named in its own script. */
  function localeLabel(rawLocale) {
    return LOCALES[locale(rawLocale)].label;
  }

  root.XVQ_I18N = {
    DEFAULT_LOCALE,
    LOCALES,
    normalizeLocale,
    defaultLocale,
    locale,
    t,
    dir,
    localeLabel,
  };
})(globalThis);

// Some worlds wrap the global differently; publish on both so no consumer has to guess.
if (typeof window !== 'undefined') window.XVQ_I18N = globalThis.XVQ_I18N;