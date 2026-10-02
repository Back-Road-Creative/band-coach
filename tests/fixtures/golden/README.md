# Golden melodies

Each file is a beginner-book melody written out by hand, before the app's own song data was read. The tests in `tests/unit/golden-songs.test.mjs` compare the app against these files. A golden file is never edited to match the app: if they disagree, a person decides which one is right.

Format: `phrases` is a list of phrases; each note is `{ "off", "beats" }`, where `off` is semitones from the first note of the tune and `beats` is the length in beats. Rests are not listed. `reviewedBy: "none yet"` means no second person has checked the transcription.

## Comparison rule (fixed before the app data was read)

1. Take the app's notes in play order. Convert each pitch to semitones above or below the app's first note, and each length to beats (the app's length unit, scaled by the song's beat unit).
2. Flatten the golden phrases into one list of notes.
3. The two lists must be equal, pitch and length, note by note. Exact equality on the whole tune.
4. If the app holds only part of the tune, its list must equal the first k golden phrases flattened, for some k of at least 1. Stopping in the middle of a golden phrase, or skipping a phrase, is a mismatch.
5. The app's own phrase grouping is not compared, only the notes.
6. The lesson plan built from the song must expect exactly the same notes, in the same order, with the same lengths. Splitting them into steps is allowed; adding, dropping, reordering or re-timing any is not.
7. A song that fails the rule is left out of the test and reported. Neither the golden file nor the app is changed to make it pass.
