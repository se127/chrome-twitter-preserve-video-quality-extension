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

## Settings

**Preferred quality** — `Best available`, `2160p`, `1440p`, `1080p`, `720p`, `480p`,
`360p`, `240p`, or `Lowest available`.

**If that quality is not available** — what to do when a particular video has no such
variant:

| Option | Behaviour |
| --- | --- |
| Use the lowest available | Play the smallest variant (saves bandwidth) |
| Use the nearest available | Play whichever variant is closest in resolution |
| Use the highest available | Play the largest variant |

One deliberate exception: if your target is *above* everything the video offers (you ask for
2160p but the video tops out at 1080p), the highest variant is used regardless of this
setting. Asking for 4K and silently getting 360p is never the intent.

Portrait videos are handled — a `480x854` video counts as 480p, since quality is measured on
the **short side** of the frame.

## Behaviour notes

- Changes apply on the next page load; the popup has a **Reload X tabs** button.
- The extension only touches HLS master playlists. Non-HLS videos, and videos with a single
  variant, are left alone.
- Both `XMLHttpRequest` and `fetch` are intercepted, since X uses either depending on player
  and build.
- A small read-only badge in the bottom-right shows the active setting.
- Requires a reload after installing or changing permissions for an already-open tab.

## Layout

```
manifest.json                        MV3 manifest
src/content/playlist-hijack.js       MAIN world: rewrites the m3u8 master playlist
src/content/settings-bridge.js       ISOLATED world: mirrors chrome.storage -> localStorage
src/popup/                           popup UI (popup.html/css/js)
test-hijack.js                       tests for the playlist rewriter
```

Two content scripts are needed because the playlist rewriter must run in the page's own JS
realm to patch `XMLHttpRequest`/`fetch` (and so cannot use `chrome.*` APIs), while the popup
lives on the extension origin (and so cannot reach `x.com`'s `localStorage`). The bridge
script connects them.

## Tests

```sh
bun test-hijack.js
# or
node test-hijack.js
```

## Privacy

No network requests, no analytics, no tracking. The extension only rewrites playlists that
the page is already loading, and stores your choice locally.