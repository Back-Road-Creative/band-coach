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
instruments ask for permission; a MIDI keyboard is optional. If you have more than one input
(e.g. an audio interface), pick it from the input list next to Connect. "Check my microphone"
listens for 3 seconds of quiet and tunes the listening thresholds to your room and hardware
instead of a one-size-fits-all level; a small meter shows the live input level.

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
- `tests/build/pages.test.mjs` and `tests/build/pages-offline.test.mjs` check the "phone copy"
  PWA build (below): the file set, the manifest, the generated icons, the service worker's
  precache list, that it never changes the one-file release build, and — in headless Chromium
  against a throwaway loopback HTTP server — that the service worker actually activates and the
  app still renders after the server is stopped and the page reloaded.

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
for those primitives, and `for-instrument.js` bridges an instrument record
and a target MIDI note into what the engine needs (clef, the written pitch —
guitar and bass print an octave above their sounding pitch, per each
record's `writtenOctaveUp` — and a tab position for fretted instruments).

Keyboard, guitar, bass, ukulele and voice each have a per-instrument "Show"
preference (note names, staff, or both) that draws this staff as an overlay
alongside the existing display; it defaults to "Note names (today)", so
nothing changes unless a learner switches it. Wind and brass keeps its own
hand-drawn staff (task-row layout, live tuning gauge, hold timer) rather
than being swapped onto the engine, since the two are not equivalent.
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

`src/app.js`'s own trainer definitions (the `MODS` object) read tuning, name
and mic range for each `'ready'` fretted instrument straight off its
`src/instruments/` record (`instrumentById`, `rangeForInstrument()`) rather
than restating them; `MODS`'s built-in keyboard/voice/wind/harp/ear/rhy
trainers are not backed by an `src/instruments/` record and are unaffected.

Ready fretted instruments as of this writing: guitar (`gtr`), bass (`bass`),
ukulele (`uke`), mandolin, 5-string banjo, 5-string bass, low-G ukulele and
baritone ukulele. The pitch detector's analysis frame size (how many samples
`yin()`, `src/audio/yin.js`, gets to autocorrelate against) is derived
per-instrument from each record's own `range.low` by
`frameSizeForInstrument()` (`src/audio/range.js`), not a single fixed size —
a low string whose fundamental period would not fit inside the default
2048-sample window (bass's open E, 5-string bass's open B0) gets a bigger
window (4096) instead of going undetected or misdetected. Only instruments
that need it pay the extra ~42ms of analysis latency; everything else stays
at 2048. See `src/audio/pitch-worklet.js` for how the AudioWorklet pipeline
resizes on an instrument switch.

## Piano hands together

The keyboard mod's level 13 is "hands together": the right hand and left hand each play one note
at the same time, in C-major five-finger position (RH thumb-on-C, fingers 1-2-3-4-5 on C-D-E-F-G;
LH little-finger-on-C an octave down, fingers 5-4-3-2-1 on the same letter names), moving in
parallel motion up the position — the standard first two-hand material in beginner method books.
The curriculum, fingering table and grading are pure logic in `src/core/hands-together.js`
(`node --test tests/unit/hands-together.test.mjs`), wired into the keyboard mod's `onNote()` in
`src/app.js`.

A real MIDI keyboard delivers independent note-on events, so both notes are checked together and
graded exactly (`gradeHandsTogetherExact`); two hands on the computer keys count the same way.
A single detected pitch — as a monophonic microphone pitch detector would report — can confirm at
most one of the two notes and never both at once, so that grading is approximate
(`gradeHandsTogetherApprox`) and the on-screen feedback says so in plain words rather than claiming
both hands were heard.

Ready mallet percussion (`mallet-percussion`, "bells"/glockenspiel) reuses
`MODS.kbd`'s own keyboard rendering (`drawKeys()`) rather than the
fretted/plucked instruments' fretboard diagram — a bell/xylophone bar row is
a keyboard layout, not a fretboard — and MODS input `'pluck'` (3 stable
frames plus onset re-strike detection) rather than `'sustain'`, since a
struck bar does not ring long enough to hold a steady pitch. Its
`src/instruments/mallet-percussion.js` record documents the mic
detectability measurement (a synthesized inharmonic bar tone through
`yin()`) that justified shipping it `status: 'ready'` rather than `'planned'`.

Oboe (`src/instruments/oboe.js`) ships `status: 'planned'`: it is already
nameable through the existing generic wind mod's concert-pitch group
(`WIND_KINDS.c` in `src/app.js` already lists "flute, oboe, violin"), so it
needs no new MODS entry, but it has no curriculum yet and no fingering
data — this repo's `src/instruments/how/` fingering-chart helpers only cover
open/closed-hole instruments (recorder, tin whistle) and valve/slide brass,
neither of which fits a keyed woodwind like oboe.
## Rhythm vocabulary

`src/core/rhythm.js` is a pure rhythm-notation module: cells (quarter, eighth pairs, rests, ties,
dotted-eighth-plus-sixteenth, eighth/quarter triplets, plus 3/4 and 6/8 patterns) expressed as exact
integer-tick durations, so triplets and swing are exact fractions rather than rounded beat offsets.
`buildPhrase`/`onsetsOf`/`validateBar` are unit-tested in isolation under `tests/unit/rhythm.test.mjs`.
Rhythm reading (`rhy`) gains eight further levels built on it, after the original ten-cell levels:
rests, ties, dotted-eighth figures, triplets, 3/4, 6/8, swing, and two-bar phrases.

## Windows Store edition

`store/` packages the same built `dist/band-coach.html` into an unsigned Windows App Package
(`.appx`) with a thin Electron shell, built on GitHub Actions' `windows-latest` runner (this repo
has no Windows machine of its own, and the Microsoft Store re-signs whatever you submit for free,
so no paid signing certificate is needed). It's a separate `package.json` under `store/` — the
app itself gains no new dependency. See `store/README.md` for how to get your app's identity from
Partner Center, run the `store-package` workflow, and submit the resulting `.appx`.
## Phone copy

Band Coach is also published as an installable web app ("Add to Home Screen") at
`https://back-road-creative.github.io/band-coach/` — free GitHub Pages hosting from this same
repo, never `headlessmode.com`. It is **the same app**: `npm run pages` (`node build/build.mjs
--pages` → `dist/pages/`) takes the exact same release build as the desktop download and adds
only what installing and offline use need — a web app manifest, a service worker that
cache-first's the app shell, and a few icon sizes generated at build time (no image file is
committed, no dependency added; see `build/pages.mjs` and `build/pages/png.mjs`). It never
changes `dist/release/band-coach.html` or `dist/band-coach.html` — those stay the exact
zero-network, one-file downloads they've always been (`tests/build/pages.test.mjs` proves the
release file is byte-for-byte identical whether or not the pages edition is built).

**iPhone microphone behaviour is unmeasured.** This edition has only been proven in headless
Chromium against a loopback test server (`tests/build/pages-offline.test.mjs`) — that it installs,
its service worker activates, and it renders after going offline. Whether Safari on an actual
iPhone grants and sustains microphone access the way this app expects is a separate, open
question; the plan's later phase tests that on real phones. Until then, don't tell a learner it
works on their phone — only that a phone copy exists to try.

`.github/workflows/pages.yml` builds and deploys `dist/pages/` on every published GitHub release
(and by hand via "Run workflow"), using `actions/upload-pages-artifact` and
`actions/deploy-pages`. **One manual step the repo owner has to click once, that this workflow
cannot do for you:** Settings → Pages → Source: GitHub Actions.
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

## Licence

Apache-2.0 — see `LICENSE`.
