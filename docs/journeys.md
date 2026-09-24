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

## Known gap (not fixed by this change)

On a fresh first paint at 390×844, with the instrument sheet open, the Start button currently
renders **below** the first screen (measured: top 1162px, bottom 1213px, against an 844px-tall
viewport) — a first-time visitor on a phone has to scroll to find Start before choosing an
instrument, even though it is back in the first screen (top 676px, bottom 727px) the moment an
instrument is chosen. `tests/characterization/journey-first-visit.test.mjs`'s first test pins this
as a real, currently-failing assertion rather than loosening it to pass — the fix (shortening or
collapsing the open instrument sheet, or moving Start above it) belongs to its own unit.
