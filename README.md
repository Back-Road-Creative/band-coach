# Band Coach

One coach, many instruments. Band Coach listens through a microphone or a MIDI keyboard, picks
every next exercise from your own results, and watches your energy so practice stays fresh.
Free, no account, and your sound never leaves your computer.

**Status: pre-release.** The app is developed as a source tree under `src/` and built into a single
file, `dist/band-coach.html` — the same one-file-download shape as the original hand-edited page.
Known judging flaws are being fixed before the first public release.

Band Coach hears pitch and timing. It cannot see posture, breath, bowing or hand position — use a
teacher or video for those.

## Run it

```
npm ci
npm run build
```

Then open `dist/band-coach.html` in Chrome or Edge (double-click). That's the one file a learner
downloads and runs — everything else under `src/` is only needed to build it. Microphone
instruments ask for permission; a MIDI keyboard is optional.

## Test

```
npm test
```

Needs Node 22+. `pretest` runs the build first, so tests always see a fresh `dist/band-coach.html`,
and `posttest` runs the release gate (`npm run gate`) so a plain `npm test` also proves the release
file downloads cleanly. Tests use only Node built-ins plus `esbuild` (the one build-time dependency).

Four kinds of tests live under `tests/`:

- `tests/import.test.mjs` checks the built file stays one self-contained page.
- `tests/build/*.test.mjs` check the build itself — one output file, one inlined script.
- `tests/characterization/*.test.mjs` drive the real, built app in a headless
  Chromium over the Chrome DevTools Protocol (`tests/helpers/browser.mjs`,
  Node's built-in `WebSocket`/`fetch`, no npm dependency) and pin its
  current, as-shipped behaviour — this is what proves a future change to
  `src/` changes nothing a learner can see.
- `tests/release/gate.test.mjs` (`npm run gate`) builds the release file
  (`node build/build.mjs --release` → `dist/release/band-coach.html`) and drives *that* file the
  same way, plus a fake microphone, to prove the thing a learner actually downloads works: no
  network calls, no console errors, the debug hook is gone, the version is stamped, the file is
  under the 1.5 MB size budget, and a note played into the microphone is heard.

Some npm setups run with `ignore-scripts` on (check `npm config get ignore-scripts`), which skips
`pretest`/`posttest` entirely — run `npm run build`, `npm test`, and `npm run gate` as separate
commands there. CI always runs the full `pretest` → `test` → `posttest` chain.

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

## Backups

Progress is saved in the browser, keyed to the exact file path Band Coach was opened from — moving
or re-downloading the file can lose it, since browsers do not share that storage across paths. Use
"Save a backup" in the app to download `band-coach-progress.json`, and "Restore a backup" to load
one back in. A quiet reminder appears on a fresh profile and after a while without a backup.
## Notation engine

`src/notation/` is a pure layout engine for standard notation and tab: given
notes and a key/clef/time signature, it returns plain drawing primitives
(noteheads, stems, ledger lines, accidentals, clefs, key/time signatures,
tab fret numbers) rather than drawing directly, so it can be unit-tested with
`node --test` and no browser. `draw-canvas.js` is a thin Canvas 2D renderer
for those primitives. It replaces the app's current treble-only staff with
support for bass/alto/tenor clef, a grand staff, key signatures, correct
enharmonic spelling and tab — but this module is not wired into the running
app yet; `src/app.js` still draws its own staff until a later change swaps
the call site over.
## Instruments are data

Each instrument is a plain data record under `src/instruments/`, validated by
`validateInstrument` in `src/instruments/schema.js` (id, name, family, input,
pitch range, transposition, clefs, an octave-matching policy, an optional
string tuning, and an ordered curriculum). `src/instruments/index.js` exports
`INSTRUMENTS` and `byId`.

To add an instrument: create `src/instruments/<id>.js` exporting a default
object matching the schema, import it in `index.js`, and add it to the
`INSTRUMENTS` array. Set `status: 'planned'` and `curriculum: []` if its
lesson content isn't written yet; use `status: 'ready'` with a non-empty
`curriculum` once it is. Run `npm test` — `tests/unit/instruments.test.mjs`
checks every record against the schema.

As of this writing `src/app.js` still has its own instrument definitions
(the `MODS` object) and does not yet read `src/instruments/`; that
switch-over is a separate, later change.
## Windows Store edition

`store/` packages the same built `dist/band-coach.html` into an unsigned Windows App Package
(`.appx`) with a thin Electron shell, built on GitHub Actions' `windows-latest` runner (this repo
has no Windows machine of its own, and the Microsoft Store re-signs whatever you submit for free,
so no paid signing certificate is needed). It's a separate `package.json` under `store/` — the
app itself gains no new dependency. See `store/README.md` for how to get your app's identity from
Partner Center, run the `store-package` workflow, and submit the resulting `.appx`.
## Releasing

The file a learner downloads is one page, built from `src/` in release mode: minified,
version-stamped, and stripped of the `window.__coach` debug hook. It's published at

```
https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html
```

To cut a release:

1. Bump `"version"` in `package.json`.
2. Tag the commit `vX.Y.Z` (matching that version exactly) and push the tag.

`.github/workflows/release.yml` does the rest: it runs the full test suite plus the release gate
(`npm run gate` — builds `dist/release/band-coach.html` and drives it in headless Chromium to prove
zero network calls, zero console errors, the debug hook is gone, the version is stamped, and a note
played into a fake microphone is actually heard), then publishes that one file as `band-coach.html`
on the GitHub release. The job fails the tag if it doesn't match `package.json`'s version, and fails
the gate if the file exceeds a 1.5 MB size budget.

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
