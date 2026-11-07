# What each capture path can prove

`src/core/input-event.js` holds `DIM_CAPABILITY`, the one table of which grading dims each
`assess` value can ever prove: `tap` only `onset`; `mic-single-note` never `chord` or `drum`;
`midi` never `tune`, since a MIDI note is always in tune; `none` nothing. Dim names match the
grading dims in `src/ui/songs/assessed.js`. See `tests/unit/input-event.test.mjs`.

`provableDims(assess)` returns that row, or `[]` for an unknown value, and is wired in (unit E3b):
`src/ui/songs/assessed.js`'s `dimsFromStep(step, result, { assess })` moves any dim the step's
`passRule` graded, but this capability can never prove, from `dims` into `unassessed` -- a
keyboard's MIDI notes never report a tune verdict, a mic-only capability never reports a drum
verdict, regardless of what the step itself asked for. The two `src/ui/songs.js` call sites pass
`capabilityFor(practice.instrument).assess` (`src/instruments/capability.js`); omitting the third
argument (every pre-E3b caller) leaves `dimsFromStep` byte-identical.
