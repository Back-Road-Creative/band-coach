# Real-world MIDI fixtures

Both files are downloaded from the `test/midi/` directory of
[Tonejs/Midi](https://github.com/Tonejs/Midi), commit
`3e9cbe310a0d0594a96cfbed1e43a774fd707958`, which is MIT-licensed (confirmed
via `GET https://api.github.com/repos/Tonejs/Midi` → `license.spdx_id: "MIT"`).
Neither file carries a copyright meta event or any other embedded rights
notice of its own (checked by decoding every meta event before download).

Other subfolders of that same test directory (`bach/`, `bartok/`,
`beethoven/`, `debussy/`, `joplin/`) ship a separate `LICENSE` file
restricting the audio/MIDI data itself to CC-BY-SA, and `230_bpm_multitrack.mid`
/ `tchaikovsky_seasons.mid` embed copyright meta events for a commercial song
("Toby Fox") and a "no republishing" notice (kunstderfuge.com) respectively —
all of those were deliberately **not** used here.

Expected values in `tests/unit/import-midi-real.test.mjs` were derived
independently of this repo's importer using Python's `mido` library
(`pip install mido`), never from `import-midi.js`'s own output.

## beat.mid

- Source: `test/midi/beat.mid`
- Format 1, 2 tracks, 120 ticks/quarter (an odd PPQ, not a power of two)
- Track 0 (conductor): track name `untitled`, an `SMPTE offset` meta event
  (0x54, distinct from SMPTE-based *division* — exercises the "safely
  ignored" meta path), a single tempo (100 bpm), 4/4 time, C major key
  signature
- Track 1: named `Track 1`, 390 notes all on channel 9 (percussion) — every
  note-off in the file is a running-status note-on with velocity 0, so this
  exercises that path at real scale (hundreds of events) rather than the
  handful in the hand-built tests

## pitchBendTest.mid

- Source: `test/midi/pitchBendTest.mid`
- Format 1, 2 tracks, 480 ticks/quarter, empty (`""`) track-name meta events
  on both tracks — exercises the title/part-name fallback logic on real
  files, not just hand-built empty strings
- No tempo event at all (exercises the 120 bpm default with a real file)
- Track 1: channel 1, a program-change event, 3 notes, and ~90 real pitch-bend
  (0xE0) events between them

## What real-file coverage these two do not reach

Sysex (F0/F7), multiple *distinct* tempo values, and trailing bytes after an
end-of-track marker are still covered only by the hand-built bytes in
`tests/unit/import-midi.test.mjs` — no small, unambiguously-licensed real
file exercising those was found in the time available for this change.
