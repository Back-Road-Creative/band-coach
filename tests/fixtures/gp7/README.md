# Real Guitar Pro 7 fixtures

Downloaded from alphaTab's test data (github.com/CoderLine/alphaTab), used here
only as sample real-world `.gp` files to prove src/song/import-gp7.js reads what
Guitar Pro 7 itself writes, not just this repo's own hand-authored fixtures.

- Source: https://github.com/CoderLine/alphaTab
- Path: `packages/alphatab/test-data/guitarpro7/`
- Commit: `35ad1a2f2e8a94504d3653bb86813b6ec357dcf6` (develop branch, 2026-09-23)
- Licence: MPL-2.0 (see alphaTab's `LICENSE` file at that commit)

Files:

- `score-info.gp` (9,017 bytes) — exercises metadata: title "Title", artist
  "Artist", a tempo automation (120 bpm), two tracks each with a 6-string
  standard tuning (`40 45 50 55 59 64`), and each track's GM program (25,
  "Acoustic Guitar (Steel)") stored under `Sounds/Sound/MIDI/Program`, the
  shape a real Guitar Pro export uses (no `<GeneralMidi>` element).
- `time-signatures.gp` (8,815 bytes) — six `MasterBar`s that each restate
  `<Time>`: 4/4, 3/4, 2/4, 1/4, 20/32, 20/32 (the last one unchanged),
  exercising `metreChanges` against a real file, including a MasterBar that
  restates the same signature as the one before it (must not produce a
  spurious change entry).
- `notes.gp` (9,382 bytes) — a single track/bar with real `<Note>` elements
  that carry both a String/Fret pair AND an explicit `<Property name="Midi">`
  value side by side, which this importer's own hand-authored fixture never
  exercised.
