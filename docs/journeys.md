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

## Opening a song shows its lesson, not the whole library

Opening (or resuming) a song used to put its own title, current step, notation and "Play it" 
behind the whole song list, the Assignments group and a 28-card "Play it on…" instrument row —
at a 390×844 phone viewport, the lesson heading landed nearly four screens down. Opening a song
now collapses the library (and moves the instrument-picker row below the transport) so the
lesson itself is what a learner sees first, with focus moved to the song's own heading; the
library stays one click (its `<summary>`) away, with the song just opened still in it.

1. **The song's title, current step and "Play it" all sit inside the first phone screen**, and
   focus lands on the song heading.
   Proof: `node --test tests/characterization/songs-lesson-first.test.mjs`, test `opening a song
   puts its title, step and "Play it" inside a phone's first screen`.
2. **The library, Assignments and the instrument-picker row are one click away, not gone.**
   Proof: same file, test `the library, Assignments and the 28-card "Play it on…" row are
   collapsed or moved below, still reachable in one action`.
3. **Enlarging the page text still leaves the transport reachable and unobstructed.**
   Proof: same file, test `with enlarged text the transport still reaches the learner,
   unobstructed`.

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

- **F1 — closed.** Progress now also renders a "Passed with help / Passed on your own / Retained
  on a later check / Applied in a song" line (`src/ui/history.js`'s `#historyRetention`, built from
  `summarizeEvents()` in `src/core/learning-events.js`), with a plain "No checks recorded yet" line
  when there is nothing to count. Proof: `node --test tests/characterization/w-history-retained.test.mjs`.
- **F2 — fixed: activating a nav button moves focus to the destination's own heading.** After
  Tab/Enter (or Space) on a nav button that actually changes screen, focus lands on that screen's
  heading (Songs, Progress and Settings each have one; the Instrument sheet gets a small
  screen-reader-only heading of its own since it had none) instead of dropping to `<body>`, so a
  screen-reader user gets a spoken cue that the screen changed. Re-pressing the destination already
  showing (Practice at boot, or the Instrument sheet's own second press, which closes it) is a
  no-op, so those two leave focus on the nav button itself. `journey-keyboard-nav.test.mjs` asserts
  this directly.
- **F3 (fixed) — colour-contrast on Songs' "Play it on…" badges.** Once a song is open, axe-core
  used to find the instrument-card feasibility badges (`.panel-songs-badge`,
  `.panel-songs-diff-badge`) failing WCAG colour-contrast (serious), because their ink was a
  hard-coded `#000`/`#fff` instead of following the active theme. `src/styles.css` now gives each
  meaning colour (`--good`/`--warn`/`--bad`/`--muted`) its own `--*-ink` token tuned per theme (see
  `tests/unit/badge-contrast.test.mjs` for the WCAG AA numbers), and the `songs: song open` and
  `songs: add a song open` subtests in `a11y-axe.test.mjs` are real assertions again, not `todo`.
