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

3. **The app stays screen-reader-clean at every stop along the way.** axe-core finds no WCAG
   2/2.1/2.2 A/AA violations on first paint, after choosing an instrument, or once the first
   exercise is running.
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

## Escape closes an open panel

A learner who Tabs into an open panel (Songs, Progress, Ear training, Theory, History, Fingerings,
Play Along) can dismiss it with Escape from wherever focus landed inside it, without first tabbing
to a close control — the same WCAG 2.1.2/2.4.3 expectation the break card's own Escape-to-resume
already met (`src/ui/dialog-focus.js`). `src/ui/panels.js`'s `open()` attaches the Escape listener
to the panel's own container, so it only ever fires for a keydown that bubbled up from inside that
panel, and closing runs the panel's existing close path — focus returns to whatever control opened
it, same as closing any other way.
Proof: `node --test tests/characterization/a11y-panel-escape.test.mjs`.

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

## Keyboard pathway (contract)

Five listed steps a keyboard learner moves through, decided by
`pathwayState()` (`src/core/pathway.js`) from saved events and sessions plus
the caller's live MIDI proof and current level -- no DOM, no clock of its
own, the caller supplies `now`:

- **setup** -- connect a MIDI keyboard. Neither live proof this page load
  nor a MIDI event ever logged for `kbd`.
- **lesson** -- work the keyboard trainer. Proof exists but the level is
  still 1.
- **song** -- open a song and play it in. No song session or event on
  record yet.
- **check** -- play the whole piece to check it. A song has been tried but
  no qualifying check row exists yet.
- **return** -- a qualifying check row exists. `wait` until a day has
  passed since it, then `recheck`.

The check rule: MIDI input only, no assistance, the whole piece (not a
single phrase step), every dimension the app assessed came back ok.
Computer keys, screen keys, a microphone, and mixed input are all practice
-- none of them ever pass the check. An older song session row logged
before this pathway existed carries no input tag at all; it still counts
toward Progress and toward "a song has been tried", but it never counts as
a passing check.

Each step's outcome text (`src/instruments/kbd-pathway.js`) is labelled
**Not yet checked by a player** -- teaching content is never presented as
reviewed until a real player's review lands in
`src/instruments/review-ledger.js`'s ledger.

P2 wires the contract into a panel (`src/ui/pathway.js`), opened from a
"Your keyboard path" button in the keyboard trainer's own options (kbd
level only). The panel lists all five steps, marks the current one, and
offers ONE action for it: the trainer for setup/lesson, opening the
suggested starter song for song, and opening that same song straight into
Check mode for check/return -- the hand-off going through
`requestOpenSong`'s new, optional `mode` parameter (`src/ui/songs.js`), so a
learner following the panel lands in Check mode rather than Learn. Proven
by `node --test --test-concurrency=1
tests/characterization/kbd-pathway-panel.test.mjs`.
`src/app.js`'s `startSession` is the first caller of `pathwayState`, and shows the step's outcome
text once per visit for a returning keyboard learner (`tests/characterization/plan-song-block.test.mjs`).

**P3 -- a 'complete' step past 'return', needing two pieces of played
evidence, not just elapsed time.** The FIRST qualifying check row (the
earliest one ever logged, not the latest -- see `earliestCheckRow()`)
becomes the anchor: its songId is "the song already checked", and its `at`
fixes `dueAt` (`anchor.at + DAY_MS`) for good -- a later qualifying row,
same song or different, never moves that date. From the anchor,
`pathwayState()` looks for:

- **retained** (`earliestRetainedRow()`) -- the earliest qualifying row, ANY
  songId, at or after `dueAt`. Real evidence the check still held up a day
  later, not the day simply having passed with nothing played.
- **transfer** (`latestTransferRow()`) -- a qualifying row on a DIFFERENT
  songId than the anchor's, any time after it. One row can satisfy both at
  once (e.g. the very first check on a different song lands a day later);
  a same-song recheck, however late, only ever counts toward retained.

`pathwayState()` returns `step: 'complete'` once BOTH exist. With only one
(or neither), 'return' continues with a different action: `wait` before
`dueAt`; `recheck` once `dueAt` has passed with no retained row yet;
`transfer` once retained exists but transfer doesn't (the same-song recheck
is never re-offered at that point -- that evidence is already in).

The panel (`src/ui/pathway.js`) offers the transfer song only once action
`transfer` is reached, chosen by `transferSongFor(level, anchorSongId,
seenSongIds)` (`src/instruments/kbd-pathway.js`; `seenSongIds` is every
songId any kbd song-source event carries, so the offer is a song "the
learner has not seen" and not just one they haven't been checked on --
falling back to excluding only the anchor song once nothing else unlocked
is left unseen). It shows the retained result as soon as `pathwayState`
reports a `retainedAt` (mid-'return' or at 'complete'), and the transfer
result only at 'complete'. All of this copy --
`RETAINED_TEXT`/`TRANSFER_TEXT`/`TRANSFER_DONE_TEXT`/`COMPLETE_TEXT` --
carries kbd-pathway.js's "Not yet checked by a player" label, kept out of
the five-item `reviewItems()` list so the panel's step count stays five.
Proof: `node --test tests/unit/pathway-transfer-retention.test.mjs`.

This assumes every event's `at` is a real epoch-millisecond timestamp.
It is: `makeEvent()` (`src/core/learning-events.js`) defaults `at` to
`Date.now()`, and since #324 (`fix/song-event-epoch-clock`) the song-check
call site in `src/ui/songs.js` passes no `now` override, so song rows use
the same clock as drill rows (its inline comment says why `api.now()`, the
audio clock in seconds, must never stamp `at`). `pathway.js` adds no
workaround for a mixed clock. Rows saved on a learner's device before #324
may still carry an audio-clock `at`; nothing migrates them. Live proof that
a fresh check row carries a real epoch-ms `at`: journey 3 in "Keyboard
pathway close-out" below, whose day-boundary math only works against a
real clock.

## Keyboard pathway close-out

Four end-to-end keyboard-learner journeys, each driven start to finish through real entry points
only -- clicks, a real MIDI message over a fake port, a real `KeyboardEvent`, a real `change`
event -- never `window.__coach` to drive a step (only to read state no real entry point can be
asked for: the audio clock, the recording's own start time, a mastery item's numbers). Proof:
`node --test --test-concurrency=1 tests/characterization/kbd-journey-scenarios.test.mjs`.

1. **First visit with a MIDI keyboard.** setup -> lesson -> song -> check -> return, all through
   real clicks and real MIDI notes, ending in a clean Check-mode play of the whole piece.
2. **Computer keys only.** The same walkthrough, every note a real computer-key press: practice
   genuinely progresses, Check mode is genuinely reached and played, but the pathway never reaches
   return and Progress never counts an independent pass -- a computer-key attempt is practice, not
   proof, on this instrument.
3. **Returning the next day.** Day 1 ends at return, offering to wait. `Date.now()` (not the event
   data) is moved forward a real day and the page reloaded, so day 2 is the same profile, one real
   day later. The pathway now offers a recheck; playing it cleanly is read back as retained, both
   through the pathway panel's own `.pathway-retained` note and through Progress's "Retained on a
   later check" count.
4. **Hand-alone to Both at level 13.** Twelve real "Skip ahead" clicks reach level 13, where Both
   hands together starts locked; playing the right hand alone, then the left hand alone (a real
   `change` event switches the Hands selector between them), on real MIDI, unlocks Both -- also
   reached with a real `change` event.

None of these is claimed reviewed by a player: every outcome text the pathway or the song hand-off
shows still carries "Not yet checked by a player" (`Reviewed by: none yet`), same as everywhere
else this teaching content appears. This close-out proves the pathway's own plumbing works end to
end through the UI a learner actually uses; it says nothing about whether a musician has checked
the curriculum itself. The four journeys also do not exercise the "How to play this" peek (#336) or
the one-correction review (#337), both in main but landed after this branch was cut, nor the
keyboard trainer's level 17 position change (#338), which was not in main when this was written --
none of them is named or implied anywhere in these four journeys.

**Finding: "Passed on your own" and the pathway's own check disagree about what counts.** Journey 1
measured this directly rather than assuming the task brief's "exactly one independent pass": Check
mode always restarts a lesson at step 1 (see "Keyboard pathway (contract)" above), so reaching the
final whole-piece Check row means every earlier judged step (rhythm, pitches, phrase-slow, each
tempo-ladder rung) was also just played cleanly, with no assistance, on real MIDI -- and
`isIndependentOk()` says yes to every one of them. `src/core/pathway.js`'s own `qualifies()` only
looks at the final whole-piece row (`skill === 'whole:null'`), but `src/ui/history.js`'s
`#historyRetention` line has no such filter -- it counts every independent-ok row app-wide. A real
learner's first successful Check-mode walkthrough of a song will see "Passed on your own: N" for N
= every judged step of that walkthrough, not 1. Journey 1's assertion is tied to the real,
dynamically-computed count (`events.filter(isIndependentOk).length`), not a fixed number, so it can
never drift out of step with what the app actually does; no code changed to "fix" this, since
whether N should mean "this song's steps" or "this pathway's one qualifying row" is a product
decision this unit's scope does not cover.

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
- **N1 — closed: a song attempt now records which route played it.** A judged song step's
  learning-event row (`src/ui/songs.js`'s `advance()`) carries `input: 'midi'` only when every
  judged note in the try was a real MIDI note-on, the one concrete non-midi route
  (`'computer-key'`, `'mic'`) when they all agree on something else, `'mixed'` when they do not, and
  the field is left off — never guessed — the moment any judged note's route is unknown. Proof:
  `tests/characterization/songs-input-route.test.mjs`. Still open: a screen click on the on-screen
  piano still plays an unrouted note (no `source` at all), so an attempt played that way still
  leaves `input` off rather than naming a route — owned by the keyboard-window unit.
- **N2 — closed: song rows stamp the same clock as drill rows.** A judged song step used to stamp
  its learning-event row's `at` (`src/ui/songs.js`'s `advance()`) with the audio clock
  (`api.now()`, seconds since the page opened, restarting at 0 on every reload) instead of epoch ms
  like every other row — mixing two time scales in one event stream that `summarizeEvents()` sorts
  by `at` and `pathwayState()` (`src/core/pathway.js`) spaces checks against with `DAY_MS`. Song
  rows now call `makeEvent()` with no `now` option, so they get the same `Date.now()` every drill
  row already used. A row already saved with the old audio-clock stamp (a finite `at` under `1e12`,
  the year 2001 — no page stays open that many seconds) is repaired on load
  (`src/app.js`'s `repairEventClocks`, called from `sanitizeDB`): it takes the `at` of the next row
  in save order that has a real epoch stamp, or the load time if none follows, so a repaired row is
  never dated earlier than the truth and a return/retention wait is never granted early. Proof:
  `tests/characterization/song-event-epoch-clock.test.mjs`.
