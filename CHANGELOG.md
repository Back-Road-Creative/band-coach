# Changelog

Built from the published GitHub releases, newest first. Each section is a short
summary of that release's notes; the full list is on the release page.

## 1.11.0 - 2026-10-26

- New: one screenshot per instrument and state (#544)
- New: add kit presets and left-handed setup (#546)
- New: drag each kit piece to where it sits on your kit (#549)
- New: learn my kit's pads over MIDI (#558)
- New: drum kit names and descriptions go through t() (#559)
- New: show R/L sticking as guidance, never judged (#561)
- Fix: draw the kit the way it looks from the throne (#545)
- Fix: first-run stage prompt, translated labels, tidier diagnostics (#551)
- Fix: 24 px floor for every pointer, 44 px labels on touch (#556)
- Fix: translate Settings, Progress and option rows; hide empty sections (#557)
- 66 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.10.0 - 2026-10-22

- New: drum kit record, kit layout and drawn-kit diagram (#206)
- New: percussion clef and drum-kit noteheads (#207)
- New: classify kick, snare and hi-hat hits at an onset (#208)
- New: channel-10 MIDI parts import, export and plan as drum-kit lessons (#209)
- New: drum-kit trainer — kit reading, MIDI/keys/click input, drum sounds (#210)
- New: drum kit hears kick, snare and hi-hat through the microphone (#213)
- Fix: restore refuses a backup with no profile, a newer profile version, or a broken song entry (#214)
- Fix: restore writes the songs first and leaves progress untouched when they fail (#215)
- Fix: the launcher kills its browsers when the test process exits or is signalled (#246)
- Fix: feasibility and difficulty badges meet colour contrast in both themes (#261)
- 321 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.9.0 - 2026-09-24

- New: real-audio evaluation runner reads a labelled corpus manifest; pilot protocol documented (#187)
- New: the progress file now carries the song library too, and restores it (#188)
- New: a captured tune becomes a draft song in the library and gets the full lesson (#193)
- New: Show me is a help event, not a lapse, and an approximate pass gives no level credit (#195)
- New: a failed try names the first thing to fix instead of "try that again" (#197)
- New: a step that fails the same thing twice drops into a short repair, then returns (#199)
- Fix: tag workflows guard the version and the Store package carries the release build (#177)
- Fix: stage labels keep the dark palette in the light theme (#180)
- Fix: one phrase-local clock for playback, capture and judging; rhythm steps judge onsets (#181)
- Fix: a gap between frames ends the note, so rests survive transcription (#182)
- 14 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.8.0 - 2026-09-24

- New: R10 visual polish — one accent, sentence case, 8px spacing (#174)
- Fix: keep variant families to their button's width (#167)
- Fix: read real Guitar Pro 7 files (#168)
- Fix: read real Guitar Pro 5 files (#171)
- Fix: ABC header comments, multi-tune files and bare mid-tune fields (#172)
- Fix: a % in a title, composer or part name survives export and import (#175)
- 5 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.7.0 - 2026-09-23

- New: additive model fields — tempo map, metre/key changes, velocity, part role (#81)
- New: model-pack loader — download on a press, checksum, IndexedDB cache (#82)
- New: light theme that follows the system, with a manual toggle (#87)
- New: fit a song onto guitar, bass or uke strings and frets (#89)
- New: fingerings and positions for violin, viola, cello, bass (#90)
- New: quantise heard notes to the tempo map, with triplets and pickups (#93)
- Fix: Find my range no longer counts the low note's tail as the high end (#85)
- Fix: kill the browser when it misses the DevTools startup window (#119)
- Fix: bar lines follow mid-song metre changes (#120)
- Fix: package lib/ so the Store shell does not crash at launch (#123)
- 73 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.6.0 - 2026-09-23

- New: keyed-woodwind fingering charts for flute, clarinet, oboe and saxophone (#68)
- New: a MODS entry can name its picker parent (#69)
- New: find your own singing range (#70)
- New: turn a decoded audio file into pitch frames and onsets (#71)
- New: capo, alternate tunings and a left-handed view (#73)
- New: brass, bowed strings, recorder and tin whistle become playable (#72)
- New: transcribe a tune from an audio file (#77)
- New: any key of harmonica, and bent notes (#75)
- New: send a song's notes to a MIDI keyboard ("play it for me") (#84)
- New: flute, clarinet, oboe, alto and tenor sax become playable (#78)
- Fix: group a live, cent-wobbly pitch track into whole notes (#74)
- Fix: Find my range keeps the high note; its test stops flaking (#79)
- 2 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.5.0 - 2026-09-21

- New: separate tools from instruments and disambiguate Ear training (#53)
- New: move input setup into a sheet, below choosing an instrument (#54)
- New: the side rail earns its boxes instead of reserving them (#55)
- New: name the drill Interval drill, not a second Ear training (#56)
- New: capture desktop and phone screenshots from the test browser (#58)
- New: collapse the tools and practice rows behind one control each (#57)
- Fix: read the gate and the pitch in one sample, not two (#46)
- Fix: check the asset for THIS tag, not whatever is latest (#48)
- Fix: bind worklet helpers by alias so minification cannot kill the pitch detector (#50)
- Fix: fall back to the main-thread listener when the pitch worklet stops producing frames (#51)
- 9 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.4.0 - 2026-09-21

- New: publish a version.json a stale copy can ask (#40)
- New: a check-for-updates button for the downloaded file (#44)
- Fix: report the built version, not a hardcoded 0.1.0 (#39)
- Fix: let a test wait until the app has actually heard audio (#43)
- 6 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.3.0 - 2026-09-21

- New: a one-command Windows check of the unpackaged shell (#27)
- New: draw the real Store icons and fail the suite on blank ones (#32)
- Fix: earn the connected status and show what the keyboard sends (#22)
- Fix: allow mic and MIDI for the app's own file, guard identity (#20)
- Fix: hold the reading through decay and let a string be locked (#21)
- Fix: send the calibrated gate to the worklet and route the live channel (#23)
- Fix: stamp the appx with the app's own release version (#28)
- Fix: write the Store listing description for shoppers, not maintainers (#30)
- Fix: a wobbling player reaches "tuned"; only a wrong note wipes the hold (#33)
- 7 more changes (tests, docs, maintenance and smaller features and fixes); see the release page

## 1.2.0 - 2026-09-20

- New: add oboe and mallet percussion (#13)
- New: synthesize instrument-family-shaped reference tones (#12)
- New: piano hands-together (MIDI exact, mic approximate) (#14)
- Fix: sample the deaf window at its own midpoint, not a fixed 400ms (#16)
- Fix: floor every browser wait so a loaded box cannot fail correct code (#17)
- Fix: measure a clean take's tempo rise from the take, not the run's start (#18)
- Fix: credit every ready instrument's mastery, not just the original seven (#15)
- 1 more change (tests, docs or maintenance); see the release page

## 1.1.0 - 2026-09-20

- New: wire the real spaced-repetition model into the trainer (#7)
- New: make the five fretted variants playable (#9)
- Fix: tear a panel down on close instead of stacking it (#6)
- Fix: kill Chromium's whole process group, not just the parent (#8)
- Fix: derive pitch-detector frame size per instrument (#10)
- 1 more change (tests, docs or maintenance); see the release page

## 1.0.1 - 2026-09-20

- Fix: deploy the phone copy on the tag push (#3)
- Fix: explain silent input instead of ignoring a strum (#4)
- 1 more change (tests, docs or maintenance); see the release page

## 1.0.0 - 2026-09-19

- New: v1 chain — source tree, build, judging fixes, release gate (#2)
- 1 more change (tests, docs or maintenance); see the release page
