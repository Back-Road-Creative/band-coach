# Real Guitar Pro 5 (.gp5) test fixtures

Every file here is unmodified binary test data taken from an open-source
project that ships its own Guitar Pro 5 reader, used to check
`src/song/import-gp5.js` against real .gp5 files rather than only against
a self-authored synthetic byte stream. Each file is copied verbatim and
verified byte-identical to the source at the commit below (`cmp` against a
fresh download at that exact SHA).

## tuplets.gp5

- Source: https://github.com/CoderLine/alphaTab/blob/a7f742b7898077dca6ceff80359396e3f4619ce9/packages/alphatab/test-data/guitarpro5/tuplets.gp5
- Project: alphaTab (CoderLine/alphaTab)
- Commit: `a7f742b7898077dca6ceff80359396e3f4619ce9`
- License: MPL-2.0 (see https://github.com/CoderLine/alphaTab/blob/a7f742b7898077dca6ceff80359396e3f4619ce9/LICENSE)

## multitrack.gp5

- Source: https://github.com/CoderLine/alphaTab/blob/a7f742b7898077dca6ceff80359396e3f4619ce9/packages/alphatab/test-data/guitarpro5/layout-configuration-multi-track-all.gp5
- Project: alphaTab (CoderLine/alphaTab)
- Commit: `a7f742b7898077dca6ceff80359396e3f4619ce9`
- License: MPL-2.0
- Renamed on import from `layout-configuration-multi-track-all.gp5` to `multitrack.gp5` for clarity; content is byte-for-byte unmodified.

## Voices.gp5

- Source: https://github.com/Perlence/PyGuitarPro/blob/b0a74102cf25a316f2c4ae3d03ffec3c03521358/tests/Voices.gp5
- Project: PyGuitarPro (Perlence/PyGuitarPro)
- Commit: `b0a74102cf25a316f2c4ae3d03ffec3c03521358`
- License: LGPL-3.0 (see https://github.com/Perlence/PyGuitarPro/blob/b0a74102cf25a316f2c4ae3d03ffec3c03521358/LICENSE)

## Repeat.gp5

- Source: https://github.com/Perlence/PyGuitarPro/blob/b0a74102cf25a316f2c4ae3d03ffec3c03521358/tests/Repeat.gp5
- Project: PyGuitarPro (Perlence/PyGuitarPro)
- Commit: `b0a74102cf25a316f2c4ae3d03ffec3c03521358`
- License: LGPL-3.0

## What each file exercises

- `tuplets.gp5` -- one track, two measures; measure 1 is a triplet (3
  notes in the time of 2), measure 2 is a quintuplet (5 notes in the time
  of 4) -- the two different tuplet ratios distinguish a parser that only
  gets triplets right (ratio always `2/n`) from one that reads the real
  per-tuplet ratio table.
- `multitrack.gp5` -- three tracks, one otherwise-empty measure -- stresses
  track-header byte alignment across more than one track; any
  misalignment in one track's header desyncs every track header read
  after it.
- `Voices.gp5` -- one track, three measures, uses both the primary voice
  (read) and the secondary voice (parsed and discarded) with real note
  data in both, including a stroke/beat-effect block in the primary
  voice's beats.
- `Repeat.gp5` -- one track, eight otherwise-empty measures, a 400bpm
  tempo, and a mix of repeat-open and repeat-close measure-header flags
  (with their associated data bytes) -- stresses measure-header parsing
  across many measures and several of its optional flag combinations.

None of the four fixtures exercises bends, grace notes, slides, harmonics,
trills, chord diagrams or mix-table changes, so those code paths in
`import-gp5.js` are implemented from the PyGuitarPro reference reader's
byte layout but are unverified against a real file in this repo.
