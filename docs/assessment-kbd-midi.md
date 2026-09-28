# Keyboard: live MIDI pipeline, negative controls and a timing budget (v1)

Scope: `tests/characterization/kbd-midi-negative-controls.test.mjs`. This is
one test file, run in isolation; it does not stand in for the full
characterization suite and it is not a claim of independent review by
anyone besides the author of this file.

## What was measured

Whether the keyboard practice path (`src/ui/songs.js` `advance()`, its
timing/pitch judging in `src/ui/songs/practice.js`, its input tagging, and
the pure `isIndependentOk`/`pathwayState` contract in
`src/core/learning-events.js` and `src/core/pathway.js`) correctly:

- **T1** — rejects a rhythm-step note played too early or too late, and
  accepts one played inside the step's own tolerance.
- **T2** — rejects a wrong note, a wrong octave, and a MIDI velocity-0
  note-on (parsed as note-off, so nothing is heard at all) on a pitches
  step, with a matching positive control on a clean pass, plus a recorded
  finding on a tolerated duplicate note-on (see Findings).
- **T4** — tags a step judged from more than one real input route as
  `'mixed'` (real MIDI + a real `keydown`), or `'unknown'` (real MIDI + an
  unsourced note), and never counts either toward independent proof.
- **T5** — an end-to-end whole-piece pass played on the computer keyboard
  never counts (Progress, `#historyRetention`, and `pathwayState` all agree
  it does not), while the same pass played on a real (faked) MIDI keyboard
  does count, immediately after switching input via "Practise again".

## On what

- Headless Chromium, driven over raw CDP via `tests/helpers/browser.mjs`
  (no Puppeteer/Playwright).
- A fake `navigator.requestMIDIAccess` (`tests/helpers/fake-midi.mjs`) that
  drives the real `onmidimessage` handler chain end to end — `window.__midiSend`
  delivers raw MIDI bytes, never bypassing the app's own parsing
  (`src/core/midi.js`).
- Real entry points for every input under test: `window.__midiSend`, a real
  `KeyboardEvent('keydown')` on the document, and the on-screen canvas
  cursor (`ArrowRight`/`Enter`) with a fallback to the debug hook's own
  unsourced seam only when no focusable key names the target pitch. The
  debug hook (`window.__coach`) is otherwise used only to WALK PAST steps
  that are not the one under test, via unsourced notes that log `'unknown'`
  and can never count — `walkToStep` now asserts this directly on every
  row it produces (`row.input === 'unknown'` and `isIndependentOk(row) ===
  false`), not just on T5's aggregate independent-count check.
- **T4(b)'s canvas path was measured, not assumed.** `t.diagnostic()` logs
  which route delivered the unsourced note, and every run observed
  `hook-fallback`, never the on-screen canvas cursor. Reading
  `kbdFocusInfo()`/`kbdOrder()` (`src/app.js`) shows why: `kbdOrder()`
  is built from `keyRects`, which is only populated by the keyboard-mod
  drawing loop (`src/app.js` `draw()`'s `mod === 'kbd'` branch) — the
  song-practice screen this suite drives never runs that draw path, so
  `keyRects` stays empty and `kbdFocusInfo()` returns `null` on every
  attempt. This is recorded as measured against the grounded spec's
  expectation (`src/app.js:2323` with `kbdRange` `[60,72]`), not adjusted
  to match it.
- Tolerances and expected note offsets are read from the app's own
  `buildLessonPlan(song, 'melody', instrumentById.kbd)` output at test
  start, never hard-coded. The plan's four judged-timing tolerances
  (`passRule.maxMeanErrorMs`, `src/song/lesson.js`) are: rhythm 120ms,
  phrase-slow 150ms, tempo-ladder 100ms, whole-piece 120ms. T1 exercises
  the rhythm step's 120ms and T5 the whole-piece step's 120ms; this suite
  does not exercise phrase-slow or tempo-ladder directly (see "What was
  not measured").
- All timing is measured through the app's own AudioContext clock
  (`window.__coach.audioNow() - window.__coach.songsRecordStart()`), read
  in the same in-page turn as the send; every timing-sensitive case is
  wrapped in `retryFlaky` with a fresh page per attempt.
- Every test asserts `page.exceptions` is empty (T1/T2/T4) or checks it as
  part of the pass condition (T5), so an uncaught in-page error fails the
  test outright rather than being silently absorbed.

## Mutation table (red-first evidence)

Since the feature under test predates this unit, the four tests are green
at base by construction; "red first" is demonstrated here instead by three
named mutations, applied one at a time, never committed, each reverted
(`git checkout -- src/`) before the next was applied and before this suite
was rebuilt and run green again. Every row below is a fresh measurement
against the current HEAD (which added `walkToStep`'s own per-step
`'unknown'`/`isIndependentOk` assertions) — not carried over from an
earlier revision of this file.

`walkToStep` now asserts, on every step it walks past, that the row logs
`input === 'unknown'` and `isIndependentOk(row) === false` (see the walk
helper's own comment). Because Song A/B/C all have a rhythm step before
the step under test, **M2 and M3 both trip that walk assertion on the very
first walked-past rhythm step**, inside `walkToStep` itself, for every test
that walks past one (T2, T4, T5) — before the target step (pitches/whole)
is ever reached. This hides the later, more specific verdicts (T4's mixed
verdict text, T5's Progress/pathway state) that the original prediction
below was written against: those assertions are still correct, but under
these two mutations the suite never gets far enough to exercise them.

| Mutation | What it removed | Cases that went red |
| --- | --- | --- |
| **M1** — drop the input source stamp. Deleted `practice.playedEvents[...].source = source;` (`src/ui/songs.js:1752`) and dropped the trailing `source` argument from `forwardSongNote(midi, exact, undefined, source)` (`src/app.js:1256`). | Every played note is recorded with no route at all, so Check always logs `'unknown'`. | **T1, T2, T4, T5 — all four**, measured. Every assertion keyed on `row.input === 'midi'`/`'computer-key'`/`'mixed'` fails on its own `not ok` line; T5 fails on all 3/3 retries with `row1.input: 'unknown'` (see excerpt below). |
| **M2** — drop the kbd non-MIDI gate. Deleted `if (ev.instrument === 'kbd' && typeof ev.input === 'string' && ev.input !== 'midi') return false;` from `isIndependentOk` (`src/core/learning-events.js:126`). | A keyboard row played by any route (computer key, mixed, unknown) can now read as independent-ok purely off its `dims`. | **T2, T4, T5 red; T1 green — measured.** T2/T4/T5 all target a step that sits after a judged `'rhythm'` step in the plan (Songs A and B both have one before `pitches`/`whole`); all three fail identically and immediately, inside `walkToStep`, on `assert.equal(isIndependentOk(walkedRow), false, ...)` for that walked-past rhythm row (its `dims` are clean, so without the gate it now reads independent-ok) — the pitches/whole-step assertions under test are never reached. T1 targets `'rhythm'` itself on Song C, so `walkToStep` only clicks past the unjudged `listen` step (`passRule: null`, no walked-row assertion) on the way there, and stays green. |
| **M3** — drop the check-mode `'unknown'` coercion. Replaced `const loggedInput = practice.mode === 'check' ? (input !== undefined ? input : 'unknown') : input;` with `const loggedInput = input;` (`src/ui/songs.js:1960`). | An unsourced note in Check mode is now logged with `input: undefined` instead of the string `'unknown'`. | **T2, T4, T5 red; T1 green — measured, same shape as M2.** All three reds fail inside `walkToStep`, this time on `assert.equal(walkedRow.input, 'unknown', ...)` for the same walked-past rhythm row (`input` reads `undefined`, not the string `'unknown'`) — again before the target step is reached. T1 stays green for the same reason as under M2. |

M1 sample failure (T1, representative of all four): `expected: 'midi',
actual: 'unknown'` (`row.input` at
`kbd-midi-negative-controls.test.mjs:248`); T5's three retried attempts all
report `row1.input: "unknown"` in their failure detail.

M2 sample failure (T2, representative of T2/T4/T5): `walked-past rhythm row
must never count` — `AssertionError [ERR_ASSERTION]: expected: false,
actual: true` at `walkToStep` (`kbd-midi-negative-controls.test.mjs:178`).

M3 sample failure (T2, representative of T2/T4/T5): `walked-past rhythm row
must log 'unknown'` — `+ actual undefined, - expected 'unknown'` at
`walkToStep` (`kbd-midi-negative-controls.test.mjs:177`).

## What was not measured

- Real MIDI keyboards or controllers, USB or Bluetooth; OS/driver-level
  MIDI latency or dropped messages; any hardware-specific quirk.
- The microphone judging path (this file is keyboard/MIDI-only).
- Human perception of "early"/"late" — the timing budget here is the app's
  own numeric tolerance, not a listening test.
- Any instrument other than `kbd`, and any lesson shape other than the
  three small synthetic songs built for this file.
- The release build (`dist/release/band-coach.html`) — this suite runs
  against the dev build's `dist/band-coach.html`, reached only through real
  entry points and never through `window.__coach` for the input under test,
  but the hook itself is still present in what this suite loads.
- A note: P1's `qualifies()` (`src/core/pathway.js`) only ever looks at
  whole-piece rows (`skill` starting `'whole:'`). T2's pathway assertions
  therefore relabel a pitches-step row to `skill: 'whole:null'` before
  calling `pathwayState` — a deliberate counterfactual to exercise the
  MIDI-vs-not branch of `qualifies()` in isolation, not a claim that a
  pitches-step attempt is ever fed to the real pathway unmodified. T5 is
  the direct check on real whole-piece rows, unrelabeled: it drives an
  actual `'whole'` step end to end on both routes and reads `pathwayState`
  off the real `skill: 'whole:null'` row it logs, so T2's counterfactual
  and T5's real row corroborate each other rather than standing in for one
  another.

## Findings (no fixes in this unit — follow-ups only)

1. **Extras are invisible to the pathway/Progress contract, and an
   extras-only failure still counts.** `maxExtras` is a `passRule` field
   (`src/song/lesson.js`), but `dimsFromStep` (`src/ui/songs/assessed.js`)
   never turns "too many extra notes" into a `dims` key — so an attempt
   that only failed on `maxExtras` still has every `dims` entry `'ok'`.
   `isIndependentOk` and `pathway.js`'s `qualifies()` only look at `dims`,
   so such an attempt reads as independent-ok: `summarizeEvents` counts it
   toward Progress's "Passed on your own" tally, and it would qualify P1's
   `pathwayState` toward `'return'`, exactly as if it had genuinely passed.
   Follow-up: add an `extras` (or `maxExtras`) key to `dimsFromStep`'s
   output and gate `isIndependentOk` on it, in its own unit.
2. **Two clocks in one event stream.** Song rows record `at` as
   AudioContext seconds (`src/ui/songs.js`); drill rows use epoch
   milliseconds. `pathwayState`'s `DAY_MS` spacing (`src/core/pathway.js`)
   and any cross-source ordering by `at` mix these two scales without
   normalizing them. Follow-up: normalize `at` to one clock (or carry an
   explicit clock tag on every row) before either DAY_MS spacing or any
   cross-source sort relies on it, in its own unit.
3. **Duplicate/misfired note-ons are absorbed silently.** The single-note
   forward-search match path in `judgeAttempt`
   (`src/ui/songs/practice.js`, ~line 199) never populates `extras` — a
   duplicate note-on, or a wrong-note-then-right-note pair, on a
   single-expected-note step is matched and the surplus is dropped without
   comment (demonstrated directly in T2's "duplicate note-on" case, which
   asserts the row is counted, not that this is desired behavior). Follow-up:
   have the single-note match path record unmatched note-ons as `extras`
   the same way the multi-note path does, in its own unit.
4. **No latency compensation.** `matchOneNote`
   (`src/ui/songs/practice.js:116`) compares raw onset time against the
   expected time with no allowance for MIDI transport, OS, or human motor
   latency — the timing budget measured in T1 is purely the app's own
   tolerance window, not a device-aware one. Follow-up: measure typical
   MIDI-to-`onmidimessage` latency on real hardware and decide whether a
   fixed compensation offset belongs in `matchOneNote`, in its own unit.
