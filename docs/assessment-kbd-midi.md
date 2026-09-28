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

# v2 — pathway check, transfer/retention rows and hand controls

Scope: `tests/characterization/kbd-midi-check-path.test.mjs`, run alongside
v1's file. Same one-file caveat as v1: not a claim of independent review,
and not the full characterization suite.

## What was measured

Whether the SAME real, browser-driven attempts v1 exercises also produce
rows that P1's check predicate (`isIndependentOk`,
`src/core/learning-events.js`) and P3's pathway state machine
(`pathwayState`, `src/core/pathway.js`) correctly refuse to advance on, and
whether H3's hand filter (`stepForHands`/`handsAvailable`,
`src/song/hand-filter.js`) actually restricts what gets judged when a
two-hand keyboard song is in play. P3's own retention/transfer pure
functions are already unit-tested directly
(`tests/unit/pathway-transfer-retention.test.mjs`); this file does not
repeat that — it proves the rows the app really logs at the browser level
are the ones those functions are ever asked to evaluate.

- **C1** — a clean MIDI pass in Learn (`assistance: 'shown'` always, in
  Learn and Rehearse alike) never reads independent-ok and never advances
  `pathwayState`.
- **C2** — clicking "Play it" (Learn's own demo/reveal button — see "The
  `howInline` substitution" below) before a clean MIDI pass changes nothing:
  still `assistance: 'shown'`, still refused.
- **C3** — a real computer-key press (`KeyboardEvent('keydown')`, key `'d'`
  = MIDI 64, `src/core/pckeys.js`), mid-phrase, in Check (`assistance:
  'none'`, so this isolates the input-route check from the assistance
  check): `input: 'computer-key'`, refused.
- **C4** — an unsourced ("unknown") note, driven as the JUDGED note itself
  in Check (everywhere else in this file and in v1, the same unsourced hook
  call is only ever used to walk PAST a step): `input: 'unknown'`, refused.
- **C5** — the wrong hand. A two-hand chord song, 'right' selected: playing
  the left hand's own (correct-for-left) pitch misses the pitches step
  entirely (`dims.pitch: 'miss'`); the right hand's own pitch, same step,
  passes. See "Rhythm judges WHEN, not WHAT" below for why this control
  targets the pitches step, not rhythm.
- **C6** — a step with no notes for the chosen hand. A two-hand song whose
  first phrase is right-hand-only; with 'left' selected, H3 reports
  `assessed: false` for that phrase's steps, the UI shows only "Next" (no
  "Your turn" at all), and no learning-event row is logged for it.
- **C7** (positive control) — a clean, on-time MIDI pass in Check does read
  independent-ok and does advance `pathwayState` to `'return'`. Included so
  the six negative controls above are readable as "this specific thing is
  refused", not "nothing here can ever pass".

## On what

- Same harness as v1: headless Chromium over raw CDP
  (`tests/helpers/browser.mjs`), the same fake `navigator.requestMIDIAccess`
  (`tests/helpers/fake-midi.mjs`), real entry points (a real MIDI byte
  delivery, a real `keydown`, real button clicks) for every control except
  C4, which deliberately drives the unsourced hook seam as the note under
  test.
- Two new song fixtures, built the same `challenge/1`/`song/1` shape as v1's
  Song A/B/C, both hand-tagged and both grounded against the app's own
  `buildLessonPlan` output before being written into the test (a throwaway
  node script, not shipped) rather than assumed from reading
  `src/song/hand-filter.js` alone:
  - `Song Hands Chord` — one phrase, one simultaneous rh+lh "chord" (two
    notes sharing `start: 0`), so both hands are present from the very
    first judged step, no multi-step walk needed to reach the hand control.
  - `Song Hands Rest` — a right-hand-only first phrase, then a left-hand
    note a bar later. `handsAvailable` is still `['rh','lh']` (a hand
    counts as available the moment it appears anywhere in the part), but
    the first phrase's own steps have nothing for a learner who chose
    'left' — H3's `assessed: false` branch.
- `pathwayState` needs a row's `skill` to read exactly `'whole:null'` before
  it is even looked at (`qualifies()`, `src/core/pathway.js`, unexported).
  Reaching a real `'whole'` step for six different controls was judged too
  expensive (tens of judged steps per control); every control here instead
  targets the cheapest reachable judged step (`'rhythm'` for C1–C4, C7;
  `'pitches'` for C5) and relabels the logged row's `skill` to
  `'whole:null'` before calling `pathwayState` — the same counterfactual
  v1's T2 uses. This proves the MIDI/assistance/hand branch of `qualifies()`
  in isolation; it does not prove a non-whole-step attempt is ever fed to
  the real pathway unmodified. C7 (the positive control) is the one case
  where the row's real dims (a genuine `onset: 'ok'`) also happen to be
  everything `qualifies()` needs, so its `pathwayState(...).step ===
  'return'` assertion is read the same way, but the row is still a
  relabeled rhythm-step row, not a real whole-piece one — v1's T5 remains
  the only test in this pair that drives a real, unrelabeled whole-piece
  row through `pathwayState`.
- **Rhythm judges WHEN, not WHAT — measured, not assumed.** `src/ui/songs.js`
  documents this in its own comment near the rhythm-step scoring code: a
  rhythm-step attempt is judged purely on note onset timing, any pitch or a
  clap counts. An earlier draft of C5 targeted the rhythm step and measured
  that a wrong-hand pitch played exactly on time still passed it
  (`isIndependentOk === true`) — confirming the app comment directly rather
  than trusting it — so C5 was moved to the `'pitches'` step, which does
  check pitch identity, before this file was finalized.
- **A missed judged note carries no attributable input route at all —
  measured, not assumed.** `advance()`'s `input` derivation
  (`src/ui/songs.js`) reads the route ONLY off matched (`ok`) notes — "a
  miss carries no played event to ask", its own comment. C5's miss leg was
  first written asserting `row.input === 'midi'` and measured `'unknown'`
  instead; the assertion was corrected to match the measured behavior
  (`dims.pitch === 'miss'`, no `input` claim) rather than adjusted to force
  the original prediction. The positive leg (a matched note) does carry
  `input: 'midi'`, confirming the asymmetry is about matching, not about
  MIDI delivery.
- **The app does not silence the resting hand's own notes while walking a
  two-hand step — a real finding, not a test-harness workaround.**
  `finishRecording` (`src/ui/songs.js`) passes the WHOLE, unfiltered
  `practice.playedEvents` into `judgeAttempt`, scored only against the
  selected hand's judged notes (H3) but with every OTHER note still counted
  as an unmatched extra (`passRule.maxExtras: 0`). Walking past a two-hand
  step while trying to send both hands' authored notes therefore fails that
  step on `maxExtras`, not because either hand's own pitch was wrong. C5's
  own walk (see `walkToStep`'s `hands` parameter) sends only the selected
  hand's notes while walking past the rhythm step for exactly this reason —
  the alternative (silently swallowing this as a harness bug) would have
  hidden the finding rather than recording it. No fix is in this unit; see
  Findings below.
- The `howInline` substitution: C1b's "How to play this" inline expander is
  not on this branch (grepped: no `howInline` anywhere under `src/`, and no
  `#showMeBtn`/`#earRevealBtn` equivalent lives in Songs — those are drill
  mode and ear-training only). The chosen substitute is Learn's own "Play
  it" demo button (`src/ui/songs.js`), the one on-screen control in Songs
  that plainly means "show me" and is Learn-only (Rehearse has none). C2
  distinguishes itself from C1 (a plain revealed view, no explicit reveal
  click) by pressing that button before the pass.

## Mutation table (red-first evidence)

Same discipline as v1: one mutation at a time, applied by hand, rebuilt,
this file's tests run in isolation, failing case names recorded, then
`git checkout HEAD -- <file>` and rebuilt green before the next mutation.
No mutation was ever committed. Every row is a fresh measurement against
this file's own 7 cases (C1–C7), not predicted in advance.

| Mutation | What it removed | Cases that went red |
| --- | --- | --- |
| **M1** — drop P1's kbd input-route gate. Deleted `if (ev.instrument === 'kbd' && typeof ev.input === 'string' && ev.input !== 'midi') return false;` from `isIndependentOk` (`src/core/learning-events.js`). | A keyboard row played by any non-MIDI route can now read independent-ok purely off `dims`. | **C3, C4, C5 red; C1, C2, C6, C7 green — measured.** C3 (`computer-key`) and C4 (`unknown`) fail directly on their own `isIndependentOk(row) === false` assertion. C5 fails one level up: its own `walkToStep`-walked rhythm row (an unsourced `'unknown'` note, otherwise a clean onset) now reads independent-ok, tripping `walkToStep`'s own per-row guard before C5's targeted pitches-step assertions are even reached — collateral evidence the same gate protects the walk helper's own invariant, not just this file's named controls. C1/C2 stay red-immune because Learn's `assistance: 'shown'` still fails the (unmodified) `withHelp` check on its own; C6 logs no row at all, so there is nothing for this gate to have covered; C7's route is genuinely `'midi'`, unaffected either way. |
| **M2** — drop P1's assistance gate. Removed `!withHelp &&` from `isIndependentOk`'s final `return` (`src/core/learning-events.js`). | A row with `assistance: 'shown'` can now read independent-ok purely off `dims`. | **C1, C2 red; C3–C7 green — measured.** C1 and C2 (both Learn, `assistance: 'shown'`) fail directly on `isIndependentOk(row) === false`; every other case's row already has `assistance: 'none'` (Check) so this gate was never the thing protecting them. |
| **M3** — break H3's hand filter. Swapped `HAND_BY_MODE = { right: 'rh', left: 'lh' }` to `{ right: 'lh', left: 'rh' }` (`src/song/hand-filter.js`). | `stepForHands` now judges the OPPOSITE hand's notes from the one the learner selected. | **C5, C6 red; C1–C4, C7 green — measured.** C5: with 'right' selected, the mutated filter now judges the LEFT hand's notes, so the left hand's own pitch (previously the deliberate miss) now matches and reads independent-ok — the exact inversion the control is designed to catch. C6: `Song Hands Rest`'s first phrase is right-hand-only; with 'left' selected, the mutated filter now resolves 'left' to `'rh'`, so that phrase DOES have notes for the (mutated) selected hand — `assessed` flips from false to true, the "rest" line the app shows for an unassessed step stops appearing, and C6's own `restVisible === true` assertion fails outright (`expected: true, actual: false`). Every other control never touches a hand-tagged song (Song Single) or never reaches a hand-filtered judged step (C1–C4's rhythm-step target), so H3 is simply not in their path. |

Raw failure excerpts (one representative line per mutation, from the actual
runs this table is built from):

- M1, C5: `walked-past rhythm row must never count` — `AssertionError:
  expected: false, actual: true`.
- M2, C1: `AssertionError [ERR_ASSERTION]: expected: false, actual: true`
  on `assert.equal(isIndependentOk(row), false)`.
- M3, C6: `the rest line shows for a hand with nothing to play here` —
  `AssertionError: expected: true, actual: false`.

## What was not measured

- Everything v1's own "What was not measured" already lists (real hardware,
  microphone pathways, non-`kbd` instruments) — unchanged, not repeated
  test-by-test here.
- Real-hardware MIDI latency for the pathway/check-path controls in this
  file specifically — same v1 Finding 4 follow-up (R2's hardware
  walkthrough), not re-measured here.
- Retention (a second, later-day attempt) and transfer (a different song)
  themselves: those pure functions are already unit-tested directly
  (`tests/unit/pathway-transfer-retention.test.mjs`); this file proves the
  rows feeding them are trustworthy, not the retention/transfer math itself.
- Progress's own on-screen text for any of these controls (v1's T5 already
  covers Progress agreement for a real whole-piece row; this file reads
  `pathwayState` directly instead of re-deriving the same UI-level check for
  every control).
- `qualifies()`'s two redundant direct checks (`ev.input === 'midi'` and
  `ev.assistance === 'none'`, in addition to calling `isIndependentOk(ev)`)
  were noted as a discovered design property during grounding, but a
  planned fourth mutation to prove that redundancy directly (removing only
  `qualifies()`'s own duplicate checks, leaving `isIndependentOk` alone) was
  not run — this file's spec named three mutations and this doc reports
  exactly those three, measured. The redundancy itself is real (readable
  directly in `src/core/pathway.js`) but is not evidenced here by a fourth
  mutation.

## Findings (no fixes in this unit — follow-ups only)

1. **Extras are not silenced for the resting hand during a two-hand step.**
   `finishRecording` (`src/ui/songs.js`) scores the WHOLE, unfiltered
   `practice.playedEvents` against only the selected hand's judged notes
   (H3), so a note played on the OTHER (unselected) hand during a two-hand
   step counts as an unmatched extra (`passRule.maxExtras: 0`) and can fail
   an otherwise-correct attempt. Demonstrated directly while designing C5
   (see "On what" above); not exercised as its own named case here.
   Follow-up: either drop the unselected hand's own notes from
   `practice.playedEvents` before scoring, or exclude them from the
   `maxExtras` count, in its own unit.
