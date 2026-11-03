# Hand test sheet

The sheet a person fills in for the release hand test, then pastes into the Manual row of
[release-acceptance-record.md](release-acceptance-record.md). The steps themselves are in the
README: [Before announcing a release: a five-minute human check](../README.md#before-announcing-a-release-a-five-minute-human-check).
Run them on the file the record's "Candidate artifact" row names. Fill in every row you can; write
`not run: <why>` for a row you could not do, never leave it blank.

## 1. Person-only README steps

The README holds the wording and what failure looks like. Write Pass or Fail, with one line on
what you saw.

| README step | What it covers | Pass/Fail | What you saw |
|---|---|---|---|
| 2 | MIDI keyboard | | |
| 3 | Microphone instrument | | |
| 4 | Tuner | | |
| 7 | Drum kit (fill in section 2 as well) | | |
| 8 | Phone | | |

## 2. Drum kit, pad by pad

Pick "Drum kit", connect the kit the way you really play it, open "Set up input" and go through
the set-up sheet. Then hit each pad once, in the order below, and copy the line the app shows.

| Row | Value |
|---|---|
| Saved pad list before (the list under "Hit each pad" on the set-up sheet, or "none") | |
| Saved pad list after a full "Hit each pad" | |

| Pad | Expected heard line | Heard | Pass/Fail |
|---|---|---|---|
| Kick | Kick heard -- start an exercise to see it judged. | | |
| Snare | Snare heard -- start an exercise to see it judged. | | |
| Hi-hat closed | Hi-hat closed heard -- start an exercise to see it judged. | | |
| Hi-hat pedal | Hi-hat pedal heard -- start an exercise to see it judged. | | |
| Hi-hat open | Hi-hat open heard -- start an exercise to see it judged. | | |
| Floor tom | Floor tom heard -- start an exercise to see it judged. | | |
| Mid tom | Mid tom heard -- start an exercise to see it judged. | | |
| High tom | High tom heard -- start an exercise to see it judged. | | |
| Crash | Crash heard -- start an exercise to see it judged. | | |
| Ride | Ride heard -- start an exercise to see it judged. | | |

A row passes only when the heard line names the piece you hit. A snare that reads "High tom" is a
fail, even if every other pad is right. If the line says "learned", a saved pad list overrode the
General MIDI layout for that pad: write the saved list in the "before" row and say so in the
Heard cell. That is not itself a fail, but a wrong name under a learned pad is.

## 3. What to send back

1. The filled tables above, verbatim (paste them as they are; do not summarise).
2. The copy you tested: Chrome (with its version) or the Store app.
3. The file's sha256, from `band-coach.html.evidence.json` beside the staged file. If you
   downloaded the file instead, run `sha256sum band-coach.html` and say which it is.
4. The machine, the kit or keyboard model, and the time you took.
