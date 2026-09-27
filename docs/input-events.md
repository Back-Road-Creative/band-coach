# Input-event envelope

`src/core/input-event.js` (additive; no CAPTURE path -- MIDI/mic/key/tap -- is wired to it yet) is
one envelope (`makeInputEvent`/`validateInputEvent`) shared by every future capture path.
`evidenceFor(events, { assess, dims, nowSec, staleSec })` decides what a note can actually
prove: silence, demo audio, unknown (`confidence: null`), or a stale held note (no `releaseSec`,
`onsetSec` older than `nowSec - staleSec`) never counts as evidence; `assess` caps which dims are
provable at all (`tap` only `onset`; `mic-single-note` never `chord`/`drum`; `midi` never `tune`, since a MIDI note is always in tune) regardless of
the events seen. Dim names match the grading dims in `src/ui/songs/assessed.js`. See `tests/unit/input-event.test.mjs`.

`provableDims(assess)` exposes that same ceiling without any events, and IS wired in (unit E3b):
`src/ui/songs/assessed.js`'s `dimsFromStep(step, result, { assess })` moves any dim the step's
`passRule` graded, but this capability can never prove, from `dims` into `unassessed` -- a
keyboard's MIDI notes never report a tune verdict, a mic-only capability never reports a drum
verdict, regardless of what the step itself asked for. The two `src/ui/songs.js` call sites pass
`capabilityFor(practice.instrument).assess` (`src/instruments/capability.js`); omitting the third
argument (every pre-E3b caller) leaves `dimsFromStep` byte-identical.
