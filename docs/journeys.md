# First-visit journeys

Plain-language description of the four things a first-time (and a returning) learner must be able
to do in Band Coach's navigation shell, each proven by a real browser test — never through
`window.__coach`, always through the same clicks/keys a learner would actually use. Full detail
and the exact assertions: `tests/characterization/journey-first-visit.test.mjs`.

1. **Reach the first exercise with a keyboard alone.** From a fresh profile (nothing saved), a
   learner who never touches a mouse can Tab and press Enter/Space to choose an instrument and
   start playing — no `.click()` anywhere on that path.
   Proof: `node --test tests/characterization/journey-first-visit.test.mjs` (first test).

2. **Start is on-screen on a phone, before and after choosing an instrument.** At a 390×844
   viewport (a small phone), the Start button sits inside the first screen — no scrolling needed
   — both on the very first paint (instrument sheet open) and once an instrument is chosen (sheet
   shut).
   Proof: same file, the `assertInFirstScreen` checks in the first test.

3. **The app stays screen-reader-clean at every stop along the way.** axe-core finds no WCAG 2/2.1
   A/AA violations on first paint, after choosing an instrument, or once the first exercise is
   running.
   Proof: same file, the `scan()` calls in the first test.

4. **A returning learner gets there faster.** With a saved instrument, the picker sheet starts
   shut, so a returning learner needs fewer Tab presses to reach Start than a first-time visitor
   does — and the nav Instrument button still names their saved instrument.
   Proof: same file, second test.

## Fixed: Start on the fresh first paint (P7-nav)

On a fresh first paint at 390×844, with the instrument sheet open, the Start button used to render
below the first screen, so a first-time visitor on a phone had to scroll to find Start before
choosing an instrument. Two phone-only rules (`@media (max-width: 600px)` in `src/styles.css`) fix
this without touching desktop: `.side` renders as `display: contents` so Start's row can carry
`order: -1` and appear above the stage instead of below it, and the open instrument sheet
(`#picker`) is capped to `max-height: 40vh` with its own scroll, so the page below it — nav and
Start — is always within reach. `tests/characterization/journey-first-visit.test.mjs`'s first test
proves Start stays in the first screen on both the fresh paint and once an instrument is chosen.

## A finished Practice session shows up in Progress

A learner routes to Practice with the keyboard alone, picks Keyboard, starts, answers enough
exercises for the session to actually be logged (at least 8 judged answers — nothing is recorded
below that), ends the session, then routes to Progress and finds that session reflected there.
axe-core confirms both stopping points — Practice while running, and Progress once a session
exists — stay WCAG-clean.

1. **A finished session actually appears in Progress.** `#historySummary`'s text and
   `db().sessions.length` both change once a session is logged, proving the session is real, not
   just that some panel opened.
   Proof: `node --test tests/characterization/journey-practice-progress.test.mjs`, test `a finished
   Practice session appears in Progress`.
2. **Practice running and Progress-with-a-session both stay screen-reader-clean.**
   Proof: same file, test `axe is clean on Practice running and on Progress with a session`.

## A song left mid-lesson carries on across a real navigation

A learner opens Hot Cross Buns from Songs, advances one step, leaves through the nav to Practice,
then comes back to Songs through the nav — proving the saved place in a lesson survives a real
navigation away and back, not just a page reload.

1. **Carry on is offered, names the lesson, and lands back on the step left off.**
   Proof: `node --test tests/characterization/journey-songs.test.mjs`, test `a song left for
   Practice offers Carry on when you come back`.
2. **Carry on is reachable and activatable by keyboard alone**, a real Tab stop, not skipped over.
   Proof: same file, test `Carry on resumes by keyboard alone`.

## Every destination is reachable with the keyboard alone

A returning learner (saved instrument) Tabs and presses Enter/Space to reach each of the five nav
destinations — Practice, Songs, Progress, Instrument, Settings — in the order the nav bar shows
them, with no `.click()` on the learner path.

1. **Tab + Enter reaches every destination**, and each one takes over `aria-current` (or, for
   Instrument, opens its sheet while leaving the previous destination current underneath it) the
   way a learner would expect.
   Proof: `node --test tests/characterization/journey-keyboard-nav.test.mjs`, test `every
   destination is reachable with Tab and Enter`.
2. **Space activates a nav button the same as Enter.**
   Proof: same file, test `Space activates a nav button the same as Enter`.

## axe over the Songs internal screens and Ear training

Extends the WCAG scan (`tests/characterization/a11y-axe.test.mjs`) to states the earlier scan never
reached: a song open at its first practice step, Add a song's own section, the editor and Play
Along panels (opened through `window.__coach.openPanel()` since reaching them needs an already
loaded song — Songs' own navigation is covered by the journey above), and the Ear training panel.
The device calibration sheet's subtest was also renamed from "settings sheet" to "input set-up
sheet open", since Settings is its own nav destination with its own axe scan
(`tests/characterization/settings-view.test.mjs`).
Proof: `node --test --test-concurrency=1 tests/characterization/a11y-axe.test.mjs`, subtests
`editor panel open`, `playalong panel open`, `ear panel open`, and `input set-up sheet open`.

## Known gaps

- **F1 — Progress doesn't show "retained" or "applied" labels.** Progress renders only a plain
  summary of finished sessions; the finer-grained retained/applied wording the design called for
  does not exist in `src/ui/history.js`. The journey above only checks that a finished session
  shows up, never that retained/applied text appears.
- **F2 — activating a nav button drops focus to `<body>`, not to the new screen.** After Tab/Enter
  (or Space) on any nav button, the browser's focus lands on `<body>` instead of moving to the
  destination's own heading, so a screen-reader user gets no spoken cue that the screen changed.
  `journey-keyboard-nav.test.mjs` records this as a plain fact at every stop, so a future fix is a
  one-line change to that recorded assertion, not a rewrite.
- **F3 — a real, unfixed colour-contrast violation on Songs' "Play it on…" badges.** Once a song is
  open, axe-core finds the instrument-card feasibility badges (`.panel-songs-badge`,
  `.panel-songs-diff-badge`) fail WCAG colour-contrast (serious). This is left as `{ todo: '...' }`
  on the `songs: song open` and `songs: add a song open` subtests in `a11y-axe.test.mjs` — named
  and unresolved on purpose, not excluded or weakened, since it is a real finding for the app's
  styling to fix.
