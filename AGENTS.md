# Project rules

## Git

- **Never run `git commit` (or push, tag, or otherwise create commits) until the user
  explicitly asks for it.** Make the changes, run the tests, and stop there. Editing,
  staging, and showing `git diff` / `git status` are fine.

## Toolchain

- **Always use `bun`, never `node`.** There is no `node` on this machine and there
  should be no reason to reach for it. Use **`bunx`** where `npx` would be used.

## Tests

- **Write tests for code you add or change.** Every new behaviour in this repo ships
  with coverage in the matching `test-*.js` runner, including the easy-to-miss cases:
  defaults, fallbacks, and anything locale- or direction-dependent.
- Run the full suite after changing source:

  ```sh
  bun test-hijack.js && bun test-i18n.js
  ```

## i18n

- The extension is bilingual (English / Farsi). The active language lives in
  `chrome.storage.local.locale` and is mirrored into page `localStorage` by
  `settings-bridge.js`; the MAIN-world rewriter reads it from there.
- **English is the default.** A user's choice is remembered; nothing else overrides it.
- **Text direction must be respected.** English is `ltr`, Farsi is `rtl`. Anything
  user-facing (popup, badge, page `<html>`) has to set `dir`/`lang`, not just swap words.
- All strings live in `src/common/i18n.js`. Do not hardcode user-facing text elsewhere.