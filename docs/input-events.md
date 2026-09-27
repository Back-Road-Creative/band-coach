# Input-event envelope

`src/core/input-event.js` (additive; no capture path is wired to it yet) is one envelope
(`makeInputEvent`/`validateInputEvent`) shared by every future capture path -- MIDI, mic, computer
key, tap. `evidenceFor(events, { assess, dims, nowSec, staleSec })` decides what a note can actually
prove: silence, demo audio, unknown (`confidence: null`), or a stale held note (no `releaseSec`,
`onsetSec` older than `nowSec - staleSec`) never counts as evidence; `assess` caps which dims are
provable at all (`tap` only `onset`; `mic-single-note` never `chord`/`drum`; `midi` never `tune`, since a MIDI note is always in tune) regardless of
the events seen. Dim names match the grading dims in `src/ui/songs/assessed.js`. See `tests/unit/input-event.test.mjs`.
