# Band Coach

One coach, many instruments. Band Coach listens through a microphone or a MIDI keyboard, picks
every next exercise from your own results, and watches your energy so practice stays fresh.
Free, no account, and your sound never leaves your computer.

**Status: pre-release.** `band-coach.html` is the original single-file app, imported unchanged.
Known judging flaws are being fixed before the first public release.

Band Coach hears pitch and timing. It cannot see posture, breath, bowing or hand position — use a
teacher or video for those.

## Run it

Open `band-coach.html` in Chrome or Edge (double-click). Microphone instruments ask for permission;
a MIDI keyboard is optional.

## Test

```
npm test
```

Needs Node 22+. Tests use only Node built-ins.

Two kinds of tests live under `tests/`:

- `tests/import.test.mjs` checks the file stays one self-contained page.
- `tests/characterization/*.test.mjs` drive the real app in a headless
  Chromium over the Chrome DevTools Protocol (`tests/helpers/browser.mjs`,
  Node's built-in `WebSocket`/`fetch`, no npm dependency) and pin its
  current, as-shipped behaviour — this is what proves a future refactor of
  `band-coach.html` changes nothing a learner can see.

The helper looks for a browser in this order: the `CHROME_BIN` environment
variable, a Playwright headless-shell install under
`~/.cache/ms-playwright/chromium_headless_shell-*`, then `google-chrome`,
`google-chrome-stable`, `chromium` or `chromium-browser` on `PATH`. Set
`CHROME_BIN` to point at a specific binary if none of those are found; the
tests fail loudly (never skip) when no browser turns up.

A few characterization tests are named `CURRENT BEHAVIOUR (flaw ...)`. They
pin known judging bugs on purpose so a later change to the app is forced to
touch them deliberately instead of silently inheriting the bug — they are
not something to "fix" by editing the test.

## Licence

Apache-2.0 — see `LICENSE`.
