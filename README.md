# X Video Quality

A Chrome extension that remembers the video quality you want on X (Twitter) and re-applies
it on every page load, so you stop getting 360p when you have picked something else.

## Why X ignores your choice

X serves videos as HLS *master playlists* (`.m3u8` on `video.twimg.com`). A master playlist
lists one variant per quality — 360p, 480p, 720p, 1080p. The player then picks from that
list using its own setting plus data-saver heuristics, and it re-decides on every load.
That is why setting 480p in X's own menu does not stick.

This extension rewrites the master playlist before the player sees it, leaving **only** the
variant you selected. With one option available, the player has nothing to override.

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. Open `https://x.com` in a normal tab (not a guest/incognito window)

Click the extension icon to choose a quality.

## Language

The popup, the on-page badge, and the page itself are available in **English** and
**فارسی (Farsi)**.

- **English is the default.** The extension starts in English regardless of your browser's
  language and stays there until you pick فارسی. Once you choose, your selection is saved
  and restored every time.
- **Text direction is honoured, not just the words.** Farsi lays out right-to-left — the
  popup, the badge, and X's own `<html>` element all switch to `dir="rtl"` when Farsi is
  active, and back to `ltr` for English.
- The choice is stored under the `locale` key and applies **immediately**: the popup
  re-renders as soon as you pick, and open tabs get the new `lang`/`dir` pushed to them
  live. Choosing a different language never prompts you to reload — only quality changes
  do, because the player reads that as each playlist loads.
- The language lives in `chrome.storage.local`, so it follows your profile rather than
  the site. Each language is listed in its own script (فارسی / English) so you can always
  find your own.

All strings live in `src/common/i18n.js`. Numeric quality values such as `1080p` are
identical in both languages and stay untranslated.

## Settings

**Preferred quality** — `Best available`, `2160p`, `1440p`, `1080p`, `720p`, `480p`,
`360p`, `240p`, or `Lowest available`.

**If that quality is not available** — handled automatically: the extension steps down to
the **next lowest** variant, so you never get something worse than you asked for and never
get something better you didn't want.

The rule is simply: **your choice if it's available, otherwise one step down — never up.**

| You asked for | Video offers | You get |
| --- | --- | --- |
| 1080p | 1080p | 1080p |
| 720p | 720p, 480p | 720p |
| 720p | 1080p, 480p | 480p |
| 2160p | 1080p, 720p | 1080p |
| 360p | 1080p, 720p | 720p |

**Best available** always plays the top variant and **Lowest available** always plays the
bottom one, whatever else the video offers.

The last row is the one deliberate exception: if *every* variant sits above your target,
there is nothing to step down to, so the lowest available is played instead. Asking for
240p and silently getting 360p is never the intent.

Portrait videos are handled — a `480x854` video counts as 480p, since quality is measured on
the **short side** of the frame.

## Behaviour notes

- Quality changes apply on the next page load; the popup offers **Reload X tabs**.
- The extension only touches HLS master playlists. Non-HLS videos, and videos with a single
  variant, are left alone.
- Both `XMLHttpRequest` and `fetch` are intercepted, since X uses either depending on player
  and build.
- A small read-only badge in the bottom-right shows the active setting.
- Requires a reload after installing or changing permissions for an already-open tab.

## Layout

```
manifest.json                        MV3 manifest
src/common/i18n.js                   bilingual strings, shared by all three worlds
src/content/playlist-hijack.js       MAIN world: rewrites the m3u8 master playlist
src/content/settings-bridge.js       ISOLATED world: mirrors chrome.storage -> localStorage
src/popup/                           popup UI (popup.html/css/js)
test-hijack.js                       tests for the playlist rewriter
test-i18n.js                         tests for language + text direction
```

Two content scripts are needed because the playlist rewriter must run in the page's own JS
realm to patch `XMLHttpRequest`/`fetch` (and so cannot use `chrome.*` APIs), while the popup
lives on the extension origin (and so cannot reach `x.com`'s `localStorage`). The bridge
script connects them.

`src/common/i18n.js` is loaded ahead of both content scripts and also by the popup, so all
three render the same language from one table. It touches neither `chrome.*` nor the DOM —
only the words — so it stays loadable in any world.

## Tests

```sh
bun test-hijack.js && bun test-i18n.js
```

## Privacy

No network requests, no analytics, no tracking. The extension only rewrites playlists that
the page is already loading, and stores your choice locally.