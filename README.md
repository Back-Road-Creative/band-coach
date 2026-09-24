# Band Coach

One coach, many instruments. Band Coach listens through a microphone or a MIDI keyboard, picks
every next exercise from your own results, and watches your energy so practice stays fresh.
Free, no account, and your sound never leaves your computer.

Band Coach hears pitch and timing. It cannot see posture, breath, bowing or hand position — use a
teacher or video for those.

## Get it

Download this one file and double-click it:

https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html

That is the whole app — one page, nothing to install, no account, and it keeps working with the
network off. Open it in Chrome or Edge. Microphone instruments ask for permission the first time;
a MIDI keyboard is optional. To put it away, delete the file.

A downloaded file cannot update itself — that's a browser security boundary, not a missing
feature — so the "More options" menu in the side rail carries a "Check for updates" button
instead. Press it and it asks the
Band Coach website for the current version number (nothing about your playing is sent) and
answers right there: up to date, a newer version is out with a link to get it, or it couldn't
reach the server, also with a link to get the current file. It never checks on its own — only on
a press — and a development build (one you built yourself rather than downloaded) says so instead
of checking, since there is nothing meaningful to compare.

The app follows your system's light/dark setting automatically, or pick Light/Dark yourself from the Theme control next to "Show note names" in the side rail. Two more controls next to Theme let you pick how notes are named -- letters, German (H/B), or fixed-do solfege (Do, Re, Mi...) -- and whether the black keys are spelled with sharps, flats, or today's mixed spelling.

If your microphone or keyboard is not being heard, the next two sections are the ones to read.
Everything from "Build it from source" down is for people working on the app itself.

## Setting up your input

Press "Set up input" to open Connect, the input list, "Check my microphone" and "MIDI details" —
they stay tucked away until you need them, so the status line (whether the app is hearing you) and
the MIDI activity dot are the only things shown up front.

If you have more than one input
(e.g. an audio interface), pick it from the input list next to Connect. "Check my microphone"
listens for 3 seconds of quiet and tunes the listening thresholds to your room and hardware
instead of a one-size-fits-all level, including the level the pitch detector itself gates on; a
small meter shows the live input level. An instrument plugged into only one channel of a
2-channel interface is summed into the listening path rather than silenced.

Press "Connect MIDI" to use a keyboard. The status line only says a device is connected once the
page has actually opened it, so "Keystation found. Press any key on it." means the keyboard is
wired up but the app has not heard a note yet, and "Keystation is working." means it has. If it
instead says another program may be using the keyboard, close whatever else has it open (another
tab, a DAW) and press Connect again — though it is worth pressing a key first, because the app
listens to every port whether or not it managed to open it, and a note actually arriving is taken
as better proof than opening the port was. A small dot next to Connect blinks on every MIDI byte the
page receives, even with no exercise running — useful for telling "the app cannot see my keyboard"
apart from "the app sees it but has nothing to judge right now". "MIDI details" opens a readout of
every input's name, connection state and the last few raw messages heard, for tracking down a
silent keyboard on your own machine.

The pure scheduling and sending logic for "play it for me" — a song's notes sent out to a
connected MIDI keyboard so it plays itself — lives in `src/core/midi.js` (`scheduleSong`,
`playOnOutput`, `stopAll`, `describeOutputs`); there is no button wired to it yet.

## Build it from source

Everything from here down is for building Band Coach yourself or working on it. If you only want
to practise, you are done above.

```
npm ci
npm run build
```

That writes the same page to `dist/band-coach.html`. `npm run build -- --release` writes the
minified one attached to each release, `dist/release/band-coach.html` (`build/build.mjs:8-9`).
Everything under `src/` is only needed to build it.

Run `npm run build && npm run shots` to actually LOOK at the UI: it drives the built app in the
same headless Chromium the tests use and writes `dist/screenshot-desktop.png` (1440x900) and
`dist/screenshot-phone.png` (390x844, phone viewport emulation on) — so a UI change can be checked
visually without a human pasting an ad hoc shell command, and `tests/build/shots.test.mjs` proves
the capability itself still works.

## Test

```
npm test
```

Needs Node 22+. `pretest` runs the build first, so tests always see a fresh `dist/band-coach.html`,
and `posttest` runs the release gate (`npm run gate`) so a plain `npm test` also proves the release
file downloads cleanly. Tests use only Node built-ins plus `esbuild` (the one build-time dependency).

Four kinds of tests live under `tests/`:

- `tests/import.test.mjs` checks the built file stays one self-contained page.
- `tests/build/*.test.mjs` check the build itself — one output file, one inlined script.
- `tests/characterization/*.test.mjs` drive the real, built app in a headless
  Chromium over the Chrome DevTools Protocol (`tests/helpers/browser.mjs`,
  Node's built-in `WebSocket`/`fetch`, no npm dependency) and pin its
  current, as-shipped behaviour — this is what proves a future change to
  `src/` changes nothing a learner can see.
- `tests/release/gate.test.mjs` (`npm run gate`) builds the release file
  (`node build/build.mjs --release` → `dist/release/band-coach.html`) and drives *that* file the
  same way, plus a fake microphone, to prove the thing a learner actually downloads works: no
  network calls, no console errors, the debug hook is gone, the version is stamped, the file is
  under the 1.5 MB size budget, and a note played into the microphone is heard.
- `tests/build/pages.test.mjs` and `tests/build/pages-offline.test.mjs` check the "phone copy"
  PWA build (below): the file set, the manifest, the generated icons, the service worker's
  precache list, that it never changes the one-file release build, and — in headless Chromium
  against a throwaway loopback HTTP server — that the service worker actually activates and the
  app still renders after the server is stopped and the page reloaded.

Some npm setups run with `ignore-scripts` on (check `npm config get ignore-scripts`), which skips
`pretest`/`posttest` entirely — run `npm run build`, `npm test`, and `npm run gate` as separate
commands there. CI always runs the full `pretest` → `test` → `posttest` chain.

The helper looks for a browser in this order: the `CHROME_BIN` environment
variable, a Playwright headless-shell install under
`~/.cache/ms-playwright/chromium_headless_shell-*`, then `google-chrome`,
`google-chrome-stable`, `chromium` or `chromium-browser` on `PATH`. Set
`CHROME_BIN` to point at a specific binary if none of those are found; the
tests fail loudly (never skip) when no browser turns up.

`npm test` caps how many test files (and therefore how many Chromiums) run at
once: a quiet box keeps node's own default (one less than the core count), but
past that the cap backs off as the box's load average climbs, so the suite
can't launch more browsers than the machine can actually boot in time
(`computeTestConcurrency` in `tests/helpers/browser.mjs`). A quiet box is
deliberately left exactly as it was — raising concurrency even by one starves
the real-time audio tests. If a box is loaded by something the load
average doesn't capture, set `BAND_COACH_TEST_CONCURRENCY` to force a lower
number.

The `test` script computes that cap with a `$(...)` command substitution, so it
needs a POSIX shell. That covers Linux, macOS and WSL, which is everything this
repo and its CI actually run on. In a bare Windows `cmd.exe` it will not expand:
run `node --test` yourself with an explicit `--test-concurrency=<n>`, or set
`BAND_COACH_TEST_CONCURRENCY` and use a shell that supports it.

A few characterization tests are named `CURRENT BEHAVIOUR (flaw ...)`. They
pin known judging bugs on purpose so a later change to the app is forced to
touch them deliberately instead of silently inheriting the bug — they are
not something to "fix" by editing the test.

`tests/characterization/a11y-axe.test.mjs` runs [axe-core](https://github.com/dequelabs/axe-core)
(an exact-pinned devDependency, the one runtime npm package the app itself never ships) over the
built `dist/band-coach.html` in its main states — first load, an instrument selected and a lesson
started, each side panel open, and the settings sheet — and fails on any WCAG 2/2.1 A/AA
violation. It is a real scanner check, not a hand-picked list of rules, so it catches whatever the
other a11y characterization tests above were not written to look for.

## Backups

Progress is saved in the browser, keyed to the exact file path Band Coach was opened from — moving
or re-downloading the file can lose it, since browsers do not share that storage across paths. Open
the "More options" menu in the side rail for "Save a backup", which downloads
`band-coach-progress.json`, and "Restore a backup", which loads one back in. A quiet reminder
appears once you have actually practised a while without one — never on a fresh profile, since
there is nothing yet to lose. The "My progress" panel also shows a practice calendar (minutes and
level changes, one cell per day, for the last 8 weeks) and a daily minutes goal with a streak — the
practice log itself only keeps the most recent 60 sessions, so days older than that say "earlier
sessions not kept" rather than a false zero. The backup, restore and "Check for updates" messages
above are read from the English string table in `src/core/i18n.js` (`t(id, params)`) rather than
hardcoded — a scaffold for a future locale, though only English ships today.
sessions not kept" rather than a false zero. "Print this week's report" turns the last 7 days into a
one-page, printer-friendly summary for a teacher or parent.
hardcoded — a scaffold for a future locale, though only English ships today. `src/index.html`'s own
static labels (headings, button text, help copy `src/app.js` never rewrites at runtime) go through
the same table: each element carries `data-i18n="<id>"` and keeps its English text in the markup as
a pre-JS/no-JS fallback, and `applyStaticLabels` in `src/app.js` overwrites it from `t(id)` once at
startup.

## Turning an audio file into notes

`src/audio/file-frames.js` is a pure function, `framesFromPCM`, that walks a decoded mono audio
clip (a plain `Float32Array` of samples plus its real sample rate) and produces the same
`frames`/`onsets` shape `src/song/transcribe.js` already reads from a live "Record a tune" mic
capture — so it feeds transcribe.js exactly the way a live capture does, teaching that module
nothing new. The "Record a tune" panel wires this in directly: alongside Listen/Stop, "Or choose
an audio file" lets a learner pick a recording instead of using the microphone, and it goes
through the same check-list step before anything can be practised or saved. Like the rest of this
app's pitch tracking, it is monophonic by default: a chord or a second voice reads as whichever
single pitch the detector locks onto, not as separate notes — so this writes down one melody line
at a time, from a file the same as from the mic — unless "More than one note at a time" is
checked, in which case a multipitch detector (`src/audio/analysis/multipitch.js`) splits the file
into a melody/bass/inner part per voice it hears, each shown as its own labelled lane.

## Learn this

The "Learn this" panel (`src/ui/learn.js`) is one drop zone: drop or pick a music file (`.mid`,
`.midi`, `.abc`, `.xml`, `.musicxml`, `.mxl`, `.gp`, `.gp5`) or a recording (`.wav`, `.mp3`, `.ogg`, `.m4a`,
`.flac`, `.webm`), and either way it turns into a song you can practise — the panel never asks
which kind of thing you dropped (`src/ui/learn/source.js`'s `learnSourceFor` tells notation from
audio from neither, purely from the file's name and MIME type). A notation file is imported the
same way Songs' own file input already imports one; a recording is decoded and transcribed through
the same pipeline "Record a tune"'s file input uses (see "Turning an audio file into notes" below)
— nothing about pitch tracking is reimplemented here. Either way the result is saved to the same
song library Songs reads from, then shown: the song's title, any warnings as a plain check list, a
confidence-coloured strip of notes when the transcription carries per-note confidence, the same
"Play it on…" instrument-card row Songs shows, and a "Practise this" button that opens Songs
already on that song's lesson. The same panel also has a mic door: a "Record" button that counts
you in for four beats (with a visible "1 2 3 4" and a live level meter, tempo set by a 40–200bpm
field defaulting to 90) using the exact same frame recorder `createRecorder` "Record a tune" uses
(`src/ui/editor/record.js`), then Stop hands the capture through the same `transcribe()` and the
same result view as a dropped file — a mic that is blocked or missing, or a take with nothing heard
clearly enough to turn into notes, says so in plain words rather than saving nothing silently.

Every result also offers hand-offs to the older, fuller panels rather than duplicating their
features: "Fix it up" opens "Record a tune" (`src/ui/editor.js`) with the learned song already
loaded for note-editing (`requestOpenInEditor`, read once by the editor's own `show()`, the same
cross-panel request pattern Songs' `requestOpenSong` already uses); and, only when the source was
a recording with a decoded audio buffer to hand over, "Play along with this recording" opens Play
Along (`src/ui/playalong.js`) already analysing that same audio (`requestPlayalongRecording`, an
in-memory hand-off — audio is far too big for the panel-data store). The Listen/file-input row in
"Record a tune", the file input in Play Along, and the file button in Songs each carry a short
pointer back to this panel, so a learner who lands on any of the older doors first is told where
the simpler one is. Retiring the older Record a tune / Play Along / Songs file-picker panels this
one is meant to replace is later work.

## Capture a melody

The "Capture a melody" tool (`TOOLS.capture` in `src/app.js`) is a simpler cousin of "Learn this" and
"Record a tune": press Connect, then Listen, and play, sing, hum or whistle a tune, or hold the
microphone up to a recording of one instrument playing one note at a time. Like the rest of this
app's pitch tracking it is monophonic and hears one note at a time — it cannot pull a separate part
out of a full band recording. Unlike "Learn this" and "Record a tune", it does **not** write down
timing: "Make it a lesson" (`capUse`) keeps only the pitch of each note it heard, in order, and
drops how long each note was held and how far apart they came — so what gets saved is a melody's
note order, not its rhythm. That note list (capped at 300 notes) becomes the "Practise my captured
melody" custom drill on whichever instrument you pick, four notes at a time, the same repeat-until-
clean chunking a built-in curriculum level uses.

## Songs

The Songs panel (`src/ui/songs.js`) turns a whole tune — built in, or imported from a `.mid`,
`.midi`, `.abc`, `.xml`, `.musicxml`, compressed `.mxl`, Guitar Pro `.gp`, or Guitar Pro 5 `.gp5` file — into a
step-by-step practice lesson (`src/song/lesson.js`), tracking each learner's own pass/fail record
and crediting every correctly played note toward the same mastery store a built-in drill uses. A
teacher can also hand a student a whole set of songs at once as a **challenge**: a plain `.json`
file (`src/song/challenge.js`, schema `challenge/1`) holding a title, an optional note, and a list
of songs. Picking one through the same file input adds every song to the library and shows it as
its own list — "N of M songs passed" — with each song's own pass state remembered across
sessions; a song counts as passed once its practice lesson has been played through to the end.
"Export as a challenge" turns a learner's own saved library into a downloadable `.json` a teacher
can pass along to another student, entirely by file exchange — no account, no server, no network
call involved. Each song in the list also has a "Save as…" control to download it on its own, as
MIDI (`.mid`), MusicXML (`.musicxml`) or ABC (`.abc`), using the pure exporters in
`src/song/export-midi.js`, `src/song/export-musicxml.js` and `src/song/export-abc.js`. Each phrase
step also shows a plain-word Easy/Medium/Hard difficulty (`src/song/phrase-difficulty.js`), and
after a judged try the panel draws a small bar-by-bar strip (`src/song/bar-heat.js`) naming which
bars went well and which need another pass. A band can also share a whole set list at once as a
**band pack**: a `.bandpack` file (`src/song/band-pack.js`, a small zip of song files plus a
manifest) holding several songs and, optionally, who in the band plays which part of each.
Picking one through the same file input adds every song to the library and shows any part
assignments read-only, one line per song ("Song title: Alex plays Melody, Sam plays Bass"). "Share
with your band" bundles a learner's own saved library into a downloadable `.bandpack` with no
assignments, the same file-exchange pattern as a challenge — no account, no server, no network
call. Each phrase's tempo-ladder rungs run their own "Riff Repeater" loop
(`src/ui/songs/loop-backing.js`, wiring `src/audio/stretch/loop.js`'s difficulty ladder into the
lesson): a missed attempt steps the synthesized backing's speed down, a fully clean attempt steps
it back up, and the panel always shows the current rate in plain words ("Playing at 90% speed",
"Full speed"). Only the synthesized backing is slowed this way — no starter or imported song
carries an original recording to time-stretch, so `src/audio/stretch/wsola.js` stays wired only
into the Play Along panel below. On a sustaining instrument (bowed, wind, free-reed or voice —
anything without a natural decay) a practice step also checks that each note was actually held
and played in tune, not just hit; a try that misses on holding or tuning alone is told so in plain
words ("Hold each note a little longer." / "A little sharp — aim for the middle of the note.")
instead of the generic retry prompt. Each step is played back, captured and judged on one
clock that starts at the phrase's first bar line (`originTick` on every lesson step,
`phraseSec` in `src/ui/songs/practice.js`), so a pickup rest is kept; the "Clap the rhythm"
step judges only *when* you played — any pitch, or a clap, counts — and a clap or wrong pitch
never counts as evidence of the right note toward mastery.

## Play along with a recording

The "Play Along" panel (`src/ui/playalong.js`) opens an audio file of a song, works out its
tempo, key and chords, and lets you loop any section slower — pitch unchanged — to learn your
part. "Record a take" does the same starting point a different way: press it, play or sing into
the mic, press it again to stop, and that take goes straight into the same analysis and loop —
a duet with yourself, with no file to save or open first. The capture never leaves the device and
mic permission is only asked for on that press; the pure chunk-accumulation logic (one bounded,
five-minute-capped `Float32Array` out of whatever small buffers the mic hands back) lives in
`src/audio/take-recorder.js`.

## Notation engine

`src/notation/` is a pure layout engine for standard notation and tab: given
notes and a key/clef/time signature, it returns plain drawing primitives
(noteheads, stems, ledger lines, accidentals, clefs, key/time signatures,
tab fret numbers) rather than drawing directly, so it can be unit-tested with
`node --test` and no browser. `draw-canvas.js` is a thin Canvas 2D renderer
for those primitives; `draw-svg.js` renders the same primitive list to a
standalone SVG string (same geometry, no DOM) for printing, and
`src/styles.css` has a `@media print` block that hides app chrome and prints
the notation area black-on-white. `for-instrument.js` bridges an instrument record
and a target MIDI note into what the engine needs (clef, the written pitch —
guitar and bass print an octave above their sounding pitch, per each
record's `writtenOctaveUp` — and a tab position for fretted instruments).

Keyboard, guitar, bass, ukulele and voice each have a per-instrument "Show"
preference (note names, staff, or both) that draws this staff as an overlay
alongside the existing display; it defaults to "Note names (today)", so
nothing changes unless a learner switches it. Wind and brass keeps its own
hand-drawn staff (task-row layout, live tuning gauge, hold timer) rather
than being swapped onto the engine, since the two are not equivalent.
## Instruments are data

Each instrument is a plain data record under `src/instruments/`, validated by
`validateInstrument` in `src/instruments/schema.js` (id, name, family, input,
pitch range, transposition, clefs, an octave-matching policy, an optional
string tuning, and an ordered curriculum). `src/instruments/index.js` exports
`INSTRUMENTS` and `byId`.

To add an instrument: create `src/instruments/<id>.js` exporting a default
object matching the schema, import it in `index.js`, and add it to the
`INSTRUMENTS` array. Set `status: 'planned'` and `curriculum: []` if its
lesson content isn't written yet; use `status: 'ready'` with a non-empty
`curriculum` once it is. Run `npm test` — `tests/unit/instruments.test.mjs`
checks every record against the schema.

`src/app.js`'s own trainer definitions (the `MODS` object) read tuning, name
and mic range for each `'ready'` fretted instrument straight off its
`src/instruments/` record (`instrumentById`, `rangeForInstrument()`) rather
than restating them; `MODS`'s built-in keyboard/voice/wind/harp/ear/rhy
trainers are not backed by an `src/instruments/` record and are unaffected.

A `MODS` entry that is really a variant of another one — the same
instrument, just a different build (5-string bass, low-G or baritone
ukulele) — groups under its parent in the picker instead of showing as its
own top-level button, by giving that entry a `parent: '<mod id>'` field
naming the parent's own `MODS` id. `variantParentsFrom()` in `src/app.js`
collects every such field automatically, so joining an existing family is
one field on the new instrument's own entry, not a second hand-edit to a
shared list; a `parent` naming a mod id that doesn't exist, or naming
itself, is ignored and the instrument stays top-level. Each variant keeps
its own progress (`DB.mods[id]`) — the grouping is purely visual.

Ready fretted instruments as of this writing: guitar (`gtr`), bass (`bass`),
ukulele (`uke`), mandolin, 5-string banjo, 5-string bass, low-G ukulele and
baritone ukulele. The pitch detector's analysis frame size (how many samples
`yin()`, `src/audio/yin.js`, gets to autocorrelate against) is derived
per-instrument from each record's own `range.low` by
`frameSizeForInstrument()` (`src/audio/range.js`), not a single fixed size —
a low string whose fundamental period would not fit inside the default
2048-sample window (bass's open E, 5-string bass's open B0) gets a bigger
window (4096) instead of going undetected or misdetected. Only instruments
that need it pay the extra ~42ms of analysis latency; everything else stays
at 2048. See `src/audio/pitch-worklet.js` for how the AudioWorklet pipeline
resizes on an instrument switch.

Ready bowed instruments as of this writing: violin, viola, cello and double
bass. They are fretless, so their trainer entries (`MODS.violin`, etc.) carry
a `fretless: true` flag and `input: 'sustain'` (a note is held and matched by
pitch, the same judging voice and wind already use, not plucked). `drawFret()`
checks that flag to draw a plain fingerboard with a nut but no fret wires,
and an `info`/`validId` override rewrites the string+fret item labels those
six fretted instruments already use (`stringLevels()`, with a `posWord`
argument of `'position'` instead of `'fret'`) so a learner is never told to
find a "fret" that is not there — the hint and the "time's up" text say the
same thing. Each record's curriculum stops at exactly first position (5
semitones above each open string): the instrument's own beginner
`range.high` is built from its highest open string plus 5, so no item ever
asks for a note outside the range the mic is tuned to listen for.

A processor that throws inside its own constructor fails silently from the app's point of view:
`addModule()` still resolves and `new AudioWorkletNode(...)` still succeeds, so `src/app.js` would
otherwise hold a worklet that looks connected but never posts a single frame — and because it looks
connected, the main-thread fallback (`listen()`, the same `setInterval` path used when
`AudioWorklet` is unavailable at all) would never take over. A liveness watchdog in `src/app.js`
guards against exactly this: if 0.5 seconds pass with no message from a worklet the app believes is
live, it is disconnected and discarded, `listen()` picks up on its next tick, and the event is
recorded through `recordError()` (visible via the debug hook's `errors()`) rather than silently
dropped.

## Beginner pathway status

One row per instrument module in `src/instruments/*.js` (every record with a `status` field),
generated from the same source the app reads: `status`, whether it has a non-empty `curriculum`,
which `src/instruments/how/*.js` chart (if any) `howKindFor()`/`computeHow()`
(`src/ui/fingerings/how.js`) picks for it, and whether that chart is a typed lookup table a
musician has not yet checked (`src/instruments/how/keyed-woodwind.js` and
`src/instruments/how/recorder-whistle.js`'s own "NEEDS A MUSICIAN'S CHECK" headers) or a formula
computed at runtime (fretboard, fingerboard, brass, harmonica — no per-note table to get wrong).
"None" means the instrument has no fingering/how panel at all (keyboard, voice, the generic
wind-and-brass picker, and mallet percussion): a learner still gets a curriculum and mic-matched
pitch detection, just no diagram.

| Instrument | Status | Curriculum | Fingering/how chart | Chart reviewed |
| --- | --- | --- | --- | --- |
| Keyboard | ready | yes | none | n/a |
| Guitar | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| Bass | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| Ukulele | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| Voice | ready | yes | none (sing the pitch) | n/a |
| Wind and brass (choose your instrument) | ready | yes | none | n/a |
| Harmonica | ready | yes | harmonica (computed) | yes (formula, not a typed table) |
| Violin | ready | yes | fingerboard (computed) | yes (formula, not a typed table) |
| Viola | ready | yes | fingerboard (computed) | yes (formula, not a typed table) |
| Cello | ready | yes | fingerboard (computed) | yes (formula, not a typed table) |
| Double bass | ready | yes | fingerboard (computed) | yes (formula, not a typed table) |
| Mandolin | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| 5-string banjo | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| Baritone ukulele | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| Low-G ukulele | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| 5-string bass | ready | yes | fretboard (computed) | yes (formula, not a typed table) |
| Trumpet (B flat) | ready | yes | brass valves (computed) | yes (formula, not a typed table) |
| Clarinet (B flat) | ready | yes | keyed-woodwind chart | no -- unchecked |
| Alto sax (E flat) | ready | yes | keyed-woodwind chart | no -- unchecked |
| Tenor sax (B flat) | ready | yes | keyed-woodwind chart | no -- unchecked |
| Flute | ready | yes | keyed-woodwind chart | no -- unchecked |
| French horn (F) | ready | yes | brass valves (computed) | yes (formula, not a typed table) |
| Trombone | ready | yes | brass slide (computed) | yes (formula, not a typed table) |
| Descant recorder | ready | yes | recorder chart | no -- unchecked |
| Tin whistle (D) | ready | yes | whistle chart | no -- unchecked |
| Oboe | ready | yes | keyed-woodwind chart | no -- unchecked |
| Mallet percussion (bells) | ready | yes | none | n/a |

## Capo, alternate tunings and a left-handed view

The "How to play it" panel's fretted-instrument diagrams (guitar, bass, ukulele, mandolin,
banjo) can show a capo, a named alternate tuning where one is defined, and a left-handed
mirrored diagram; bowed fretless instruments (violin, viola, cello, double bass) get the
left-handed mirror only, since they have no capo or fret-based tuning to switch. The controls
appear only for instrument kinds that make sense for them and reset to standard/no-capo/
right-handed whenever a different instrument is picked.

- Capo: a number input, counting frets from the capo, not the physical nut — a capo becomes the
  new "open string" position (`src/instruments/how/fretboard.js`'s own rule). A note that falls
  behind the capo cannot be shown; the description says so in plain words instead of just
  reporting the pitch as not found.
- Alternate tuning: only guitar (`gtr`) currently has named alternates defined (drop D, DADGAD,
  open G, open D, half-step down, in `fretboard.js`'s `TUNINGS`) — the picker only appears where
  `src/ui/fingerings/how.js`'s `alternateTuningsFor(instrument)` returns a real list, never
  guessed from string count (a 4-string ukulele tuning is not interchangeable with a 4-string
  bass tuning).
- Left-handed: mirrors which side of the diagram each string is drawn on (`fretboard.js`'s
  `leftHanded` option); the underlying pitches, strings and frets never change, only the
  drawing order.

This choice is session-only: it lives in the fingerings panel's own module state, not in the
app's saved-preferences database (`src/app.js`'s `DB.prefs`), so it resets on reload. Wiring a
persistent capo/tuning/handedness preference into that database is a follow-up, not part of this
change. Mirroring the trainer's own fretboard canvas (the practice view drawn in `src/app.js`,
separate from this reference panel) and capo-aware trainer tasks are also out of scope here.

## Piano hands together

The keyboard mod's level 13 is "hands together": the right hand and left hand each play one note
at the same time, in C-major five-finger position (RH thumb-on-C, fingers 1-2-3-4-5 on C-D-E-F-G;
LH little-finger-on-C an octave down, fingers 5-4-3-2-1 on the same letter names), moving in
parallel motion up the position — the standard first two-hand material in beginner method books.
The curriculum, fingering table and grading are pure logic in `src/core/hands-together.js`
(`node --test tests/unit/hands-together.test.mjs`), wired into the keyboard mod's `onNote()` in
`src/app.js`.

A real MIDI keyboard delivers independent note-on events, so both notes are checked together and
graded exactly (`gradeHandsTogetherExact`); two hands on the computer keys count the same way.
A single detected pitch — as a monophonic microphone pitch detector would report — can confirm at
most one of the two notes and never both at once, so that grading is approximate
(`gradeHandsTogetherApprox`) and the on-screen feedback says so in plain words rather than claiming
both hands were heard.

## Harmonica: any of the 12 keys, plus bends

The harmonica mod is not locked to a C harmonica. A "My harmonica is in the key of" selector on
the harmonica options panel picks any of the 12 keys, matching whatever is printed on your own
instrument; changing it starts a fresh exercise. Hole numbers and blow/draw directions stay the
same for every key — a 10-hole diatonic harmonica is built the same way whatever pitch it is
tuned to — only the pitch each hole sounds moves. `src/instruments/how/harmonica.js`'s
`layoutFor(key)` computes the ten-hole blow/draw table, and every reachable bend note, for any
key 0-11 (0 = C, matching the app's usual tonic convention); `src/app.js`'s harp lookups and the
on-screen diagram (`drawHarp`) read from it instead of a fixed C table, and the microphone's
search window (`MODS.harp.fmin`/`fmax`) is computed from the chosen key's own layout so a
higher- or lower-keyed harp is not silently mis-heard.

Draw and blow bends — a reed pulled down in pitch with your breath — are new practice levels
appended after the nine open-note levels, so an existing learner's saved level numbers do not
shift. A bend is graded by its exact bent pitch, the same way an open note is graded by its own
pitch. Bend availability (which holes bend, and how deep) does not change with key, since
transposing the whole harmonica preserves the blow/draw gap inside every hole.

## Reference tones sound like the instrument

Every reference/example tone (the note a lesson plays for you to match or tune to) goes through
`tone()` in `src/app.js`, which renders an instrument-family-shaped voice from
`src/audio/voices.js` instead of one fixed beep. The voice is picked from the active instrument's
`family` (`instrumentById[mod].family`, see "Instruments are data" above): plucked/fretted and
percussion get a fast-decay Karplus-Strong-flavoured pluck, keyboard gets a brighter struck
envelope, bowed/wind/free-reed/voice get a soft-attack sustained tone, and brass gets the same
sustain shape with more upper-partial brightness. An instrument whose family isn't one of these
falls back to the plain sustained voice rather than staying silent.

This is synthesis, not sampling — every sample is computed from exact-integer-multiple sine
partials at render time (`renderVoice()` and friends), so there is no embedded audio and no extra
network/file dependency; a fundamental always lands exactly on the requested MIDI pitch, because
learners tune to it. Render functions are pure (`(family, freq, sampleRate, seconds, volume) ->
Float32Array`), which is also what lets `tests/unit/voices.test.mjs` assert pitch accuracy with
the app's own pitch detector (`src/audio/yin.js`) directly in Node, no browser required.
`tone()` opens the mic's deaf window (`src/audio/deaf-window.js`) for exactly the rendered
buffer's own length. Crucially, a rendered buffer is never LONGER than the `dur` a caller asked
for (`voiceDurationSeconds()`'s only floor, `EPSILON_SECONDS`, is far below the shortest real note
any caller passes — 0.05s on `src/ui/editor.js`'s piano roll, 0.12s on `src/ui/songs.js`'s
bpm-driven play-along): instrument character comes from each recipe's partial mix and decay
shape, not from padding a short note out to a longer minimum ring time. A fixed floor that did
that once made a fretted play-along's short notes hold the mic deaf well past the note itself,
silently swallowing whatever the learner played next — `tests/unit/voices.test.mjs` guards
against that regression directly on the rendered buffer length.

Ready mallet percussion (`mallet-percussion`, "bells"/glockenspiel) reuses
`MODS.kbd`'s own keyboard rendering (`drawKeys()`) rather than the
fretted/plucked instruments' fretboard diagram — a bell/xylophone bar row is
a keyboard layout, not a fretboard — and MODS input `'pluck'` (3 stable
frames plus onset re-strike detection) rather than `'sustain'`, since a
struck bar does not ring long enough to hold a steady pitch. Its
`src/instruments/mallet-percussion.js` record documents the mic
detectability measurement (a synthesized inharmonic bar tone through
`yin()`) that justified shipping it `status: 'ready'` rather than `'planned'`.

Ready beginner brass (`trumpet-bb`, `horn-f`, `trombone`) each get their own
MODS entry instead of reusing the generic `MODS.wind` trainer: `MODS.wind`'s
transposition comes from the learner's saved `prefs.wind`, which is right for
a single "choose your instrument" trainer but wrong for a dedicated
trumpet/horn/trombone mod, where the written notes must always read in that
instrument's own key. Each entry carries a fixed `windKind` (`'bb'`, `'f'`,
`'bc'`) that `info()`'s `'w'`-id branch in `src/app.js` prefers over
`prefs.wind` when present, so switching a learner's Wind-and-brass preference
never bends a dedicated brass mod's own transposition. `MODS.trombone`'s
curriculum items sit at written-pitch-plus-19 (`WIND_KINDS.bc`'s bass-clef
register shift for the shared `'w'` item-id space — a display convention, not
a pitch transposition; `trombone.js`'s own `transposition` stays `0`).
Drawing is shared, not duplicated: `drawStaff()` now dispatches off a generic
`M.staff` flag (set on `MODS.wind` and all three brass entries) instead of
`mod === 'wind'` by name, and `src/ui/songs/mastery.js` gets three matching
`itemIdForMidi()` cases — each folding into the record's own written range,
never reading `prefs.wind` — so a captured or sung melody credits the right
brass item too.

Flute, clarinet (B flat), oboe, alto sax (E flat) and tenor sax (B flat)
(`src/instruments/flute.js`/`clarinet-bb.js`/`oboe.js`/`sax-alto-eb.js`/
`sax-tenor-bb.js`) ship `status: 'ready'`, following the same pattern as the
brass trio above: each gets its own `MODS` entry with a fixed `windKind`
(`'c'`, `'bb'`, `'c'`, `'eb'`, `'bbt'`) so its written notes never bend to
the learner's generic Wind-and-brass preference, `staff: true` for the
shared hand-built staff, and a `src/ui/songs/mastery.js` `itemIdForMidi()`
case folding into the record's own written range. Fingering data lives in
`src/instruments/how/keyed-woodwind.js`: typed lookup tables (same shape as
`recorder-whistle.js`), one per instrument, since a keyed Boehm-system
woodwind's fingering does not fall out of a formula the way brass valve/
slide arithmetic does. `howKindFor()`/`computeHow()`
(`src/ui/fingerings/how.js`) wire all five into the fingerings panel under a
new `'keyed-woodwind'` kind. **Every fingering in that file is a good-faith
beginner fingering written from general knowledge, not yet checked against
a real chart or player** — see that file's top comment for exactly which
notes (every sharp/flat, and the oboe's top three half-hole notes) most need
a musician's check. Alto and tenor sax both start their written range at
Bb3 (midi 58), the horn's actual lowest written note — a saxophone has
nothing written below it, and `SAX_NOTES` has no entries for 55-57.
Oboe (`src/instruments/oboe.js`) is one of the five above and ships
`status: 'ready'`, not planned: it has the same seven-level curriculum shape
as the other four, and its fingering chart is `OBOE_NOTES` in the same
`src/instruments/how/keyed-woodwind.js` table, covering its full D4-D5
beginner range. The same not-yet-checked caveat applies, and the oboe's top
three notes (C5, C#5, D5) are the ones the file's own top comment names as
most likely to need a musician's correction, since they cross the
octave-key break and use the half-hole technique.

Descant recorder (`src/instruments/recorder-descant.js`) and tin whistle
(`src/instruments/tin-whistle.js`) ship `status: 'ready'` with their own
`MODS['recorder-descant']`/`MODS['tin-whistle']` entries (`src/app.js`), input
`'sustain'` like `MODS.wind`/`MODS.harp` above — a blown note is held, not
struck. Both records are written an octave below what they sound (the same
octave-only notation gap `writtenOctaveUp` documents for guitar/bass, just in
the other direction): a descant recorder's lowest written note is middle C
but it actually sounds C5, and a D tin whistle's lowest written note sounds
D5, so each record's `transposition` is `+12` and its `range` is the SOUNDING
pitch the microphone actually hears, not the printed page. Their MODS entries
carry `staff: true` and `writtenOffset: -12` for the notation drawing pass to
pick up once it honours those fields; until then the fields are inert. Each
curriculum introduces notes in beginner method-book order — recorder: B, A, G
first, then the high C and D above them, then the low E, D and C below G,
then the forked-fingering F; whistle: the D-major scale, first octave, D E
F# G A B C# D — rather than chromatic or alphabetical order.

`fitToInstrument` (`src/song/lesson.js`) fits a song part's range against
each transposing instrument's *written* pitch when its `range` is written
(clarinet, trumpet, alto/tenor sax, French horn — `transposition` not a
multiple of 12), not the sounding pitch the mic actually hears, so a song's
notes land where the learner's printed part says, not just where a real
instrument could reach; `src/song/arrange/transposing.js` computes a part's
written notes and written key signature for display.

`src/song/feasibility.js`'s `feasibility(song, partId, instrument)` turns
`fitToInstrument`'s own result into a plain-language badge -- "Fits as
written", "Transposed to G", "3 notes skipped" -- never a guessed score.
The songs panel (`src/ui/songs.js`) shows one "Play it on…" card per ready
instrument, badge included, on a lesson's first (listen) step, before the
learner has attempted anything; picking a card starts that same song on the
chosen instrument without leaving the panel.

## Rhythm vocabulary

`src/core/rhythm.js` is a pure rhythm-notation module: cells (quarter, eighth pairs, rests, ties,
dotted-eighth-plus-sixteenth, eighth/quarter triplets, plus 3/4 and 6/8 patterns) expressed as exact
integer-tick durations, so triplets and swing are exact fractions rather than rounded beat offsets.
`buildPhrase`/`onsetsOf`/`validateBar` are unit-tested in isolation under `tests/unit/rhythm.test.mjs`.
Rhythm reading (`rhy`) gains eight further levels built on it, after the original ten-cell levels:
rests, ties, dotted-eighth figures, triplets, 3/4, 6/8, swing, and two-bar phrases.

## Ear training

The Ear training screen (`src/core/ear/*`, wired in `src/ui/ear.js`) has ten listen-and-answer
exercises, each leveling up or down on its own: scale degrees, melodic dictation, dictation from
real song phrases (a 1-3 bar phrase pulled straight out of a starter song's melody -- which song
it was is only revealed after grading, never before), rhythm dictation, rhythms from songs (a bar,
two at higher levels, of a starter song's own note durations and rests, pitch dropped -- the song
title is shown up front, since this is a sight-reading drill rather than a by-ear one, and it
grades with rhythm dictation's own checker unchanged), chord progressions, scales and modes,
chord inversions, in-tune-or-not intonation discrimination, and sing-it-back.

## Find your own singing range

The Voice screen offers three fixed ranges (Lower/Middle/Higher voice) plus a fourth, "Find my
range," built from a short guided test rather than a guess. Press Connect, choose Voice, then
press "Find my range": sing your lowest comfortable note and hold it, press "Got it — now the
highest," sing your highest comfortable note and hold it, then press "Got it — done." The app
listens through the real pitch detector the whole time and shows exactly what it is hearing, so
nothing is assumed from the microphone being open alone. `src/instruments/how/voice-range.js`
turns the held notes into a range (dropping brief blips, then trimming statistical outliers
within each half, so the low end comes only from the low note and the high end only from the high one;
the low note still sounding just after the switch is not counted toward the high end),
picks the nearest voice type as a plain-language hint — never a diagnosis — and pulls a small
safety margin in from both ends before placing the exercises' tonic at the low end of that
margin-trimmed range. If what was sung is under an octave, the exercises still get a usable
tonic; the app says plainly that they will ask for a little more than was actually sung, rather
than silently clamping the top note down. The result is saved and offered again next time as "My
range (found by test)," alongside the three fixed choices, until the test is run again.

## Windows Store edition

`store/` packages the same built `dist/band-coach.html` into an unsigned Windows App Package
(`.appx`) with a thin Electron shell, built on GitHub Actions' `windows-latest` runner (this repo
has no Windows machine of its own, and the Microsoft Store re-signs whatever you submit for free,
so no paid signing certificate is needed). It's a separate `package.json` under `store/` — the
app itself gains no new dependency. See `store/README.md` for how to get your app's identity from
Partner Center, run the `store-package` workflow, and submit the resulting `.appx`.
## Phone copy

Band Coach is also published as an installable web app ("Add to Home Screen") at
`https://back-road-creative.github.io/band-coach/` — free GitHub Pages hosting from this same
repo, never `headlessmode.com`. It is **the same app**: `npm run pages` (`node build/build.mjs
--pages` → `dist/pages/`) takes the exact same release build as the desktop download and adds
only what installing and offline use need — a web app manifest, a service worker that
cache-first's the app shell, and a few icon sizes generated at build time (no image file is
committed, no dependency added; see `build/pages.mjs` and `build/pages/png.mjs`). It never
changes `dist/release/band-coach.html` or `dist/band-coach.html` — those stay the exact
zero-network, one-file downloads they've always been (`tests/build/pages.test.mjs` proves the
release file is byte-for-byte identical whether or not the pages edition is built).

It also writes `dist/pages/version.json` (`{ version, released, download }`) — the current
version, its release date and the download URL above — deliberately excluded from the service
worker's precache list so it always answers with the live version, never a cached one. This is
what lets a downloaded `band-coach.html`, which can never auto-update itself, ask whether it's
stale.

**iPhone microphone behaviour is unmeasured.** This edition has only been proven in headless
Chromium against a loopback test server (`tests/build/pages-offline.test.mjs`) — that it installs,
its service worker activates, and it renders after going offline. Whether Safari on an actual
iPhone grants and sustains microphone access the way this app expects is a separate, open
question; the plan's later phase tests that on real phones. Until then, don't tell a learner it
works on their phone — only that a phone copy exists to try.

`.github/workflows/pages.yml` builds and deploys `dist/pages/` on every published GitHub release
(and by hand via "Run workflow"), using `actions/upload-pages-artifact` and
`actions/deploy-pages`. **One manual step the repo owner has to click once, that this workflow
cannot do for you:** Settings → Pages → Source: GitHub Actions.
## Releasing

The file a learner downloads is one page, built from `src/` in release mode: minified,
version-stamped, and stripped of the `window.__coach` debug hook. It's published at

```
https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html
```

To cut a release:

1. Bump `"version"` in `package.json`.
2. Tag the commit `vX.Y.Z` (matching that version exactly) and push the tag.

`.github/workflows/release.yml` does the rest: it runs the full test suite plus the release gate
(`npm run gate` — builds `dist/release/band-coach.html` and drives it in headless Chromium to prove
zero network calls, zero console errors, the debug hook is gone, the version is stamped, and a note
played into a fake microphone is actually heard), then publishes that one file as `band-coach.html`
on the GitHub release. The job fails the tag if it doesn't match `package.json`'s version, and fails
the gate if the file exceeds a 1.5 MB size budget.

release.yml, pages.yml and store-package.yml each only prove their own artifact built -- none of
them checks that the three still agree once the tag has finished rolling out.
`.github/workflows/release-consistency.yml` runs after the same tag push and closes that gap. Since
it and `release.yml` both fire on the same tag and run concurrently, it cannot just check that
`releases/latest/download/band-coach.html` returns 200 -- a stale "latest" pointing at the
*previous* release also returns 200, which is exactly the failure this exists to catch. Instead it
looks up the release for the triggering tag by name (retrying while `release.yml` is still
publishing it), confirms that release isn't a draft and has `band-coach.html` attached, and then
confirms the `releases/latest/download/` URL above actually redirects to that same tag's asset. It
also retries against the deployed Pages `version.json` (deployment lags the tag by a few minutes)
until it reports the new version, and opens a `Store submission for vX.Y.Z` issue so the manual
Partner Center submission step is tracked instead of relied on to be remembered.

## Before announcing a release: a five-minute human check

Automated tests run headless and cannot plug in a real MIDI keyboard, play a real guitar into a
real microphone, or open a real (non-headless) browser. Before telling anyone a release is ready,
download the actual release file (`dist/release/band-coach.html`, or the one attached to the
GitHub release) and run through this by hand. Each step names what failure looks like — do not
mark a step passed just because nothing looked obviously wrong.

1. **Open the file (30s).** Double-click it. **Fail** if the page does not load, or the browser
   console (F12) shows red errors.
2. **MIDI keyboard, if you have one (1 min).** Plug it in, press "Connect MIDI". The status line
   should change to "*device name* found. Press any key on it." — this only means the app opened
   the port, not that it has heard anything yet. Press a key on the keyboard. **Pass** only once
   the status line changes to "*device name* is working." and the small dot beside "Connect MIDI"
   blinks on every key press. **Fail** if the status line stays on "found. Press any key on it."
   after you have pressed several keys (the app opened the device but the keyboard's notes are not
   reaching it), or if it says "Another program may be using this keyboard" and pressing keys
   still produces no blink (close other apps and press Connect again). Open "MIDI details" and
   confirm your keyboard is listed, with either "opened." or "open failed … but it is sending
   messages anyway." — "open failed" with nothing arriving is a fail. No physical keyboard on hand? Note
   that as untested for this release rather than skipping it silently.
3. **Microphone instrument, e.g. guitar (1.5 min).** Pick guitar (or your instrument), press
   "Connect microphone" and allow access, then press "Check my microphone" and stay quiet for the
   3-second countdown. Play one note into the mic. **Pass** if the exercise reacts to the note
   (advances, marks it, or otherwise visibly responds). **Fail** if the small input-level meter
   never moves while you play (the mic is not picking up sound) or nothing on screen ever responds
   to a clearly-played, in-tune note.
4. **Tuner — the exact bug this checklist exists for (1 min).** Switch to Tuner, press Connect,
   pick your instrument, and pluck one open string once (do not keep replaying it). Watch the
   reading after the string starts to decay. **Pass** only if the needle/reading stays on screen
   through the decay and the string turns green ("in tune") if it was in tune, without you having
   to pluck it again to keep the reading alive. **Fail** if the reading disappears or resets to
   "play a note" while the string is still ringing out.
5. **Progress survives a reload (1 min).** Play a couple of exercises so something is recorded,
   reload the page (F5), and open the same instrument again. **Pass** if your recent result is
   still there. **Fail** if progress is back to zero. (Reminder: this only works from the exact
   same file path/location each time — see "Backups" above.)
6. **Check for updates (30s).** Open the "More options" menu in the side rail and press "Check for
   updates". This is the only real network request the app ever makes, and it is made from a
   `file://` page, so nothing
   in the automated suite can stand in for it — the unit tests inject a fake fetch and the browser
   tests run a dev build, which the button deliberately refuses to check. **Pass** if it answers
   "You're running the latest version (*x.y.z*)." with the version you just released. **Fail** if
   it says "Couldn't reach the update server." (the deployed `version.json` is missing or blocked
   — the release-consistency workflow should have caught that, so check it), if it names a version
   other than the one you released, or if it still says "Checking…" after a few seconds. If it
   reports "This is a development build", you are testing the wrong file: use the one attached to
   the GitHub release, not `dist/band-coach.html`.

Total: under 5 minutes with a MIDI keyboard on hand, faster without one.

## Browser and device support — what has actually been tested

- **Headless Chromium, via this repo's automated test suite** (`tests/characterization/`,
  `tests/release/gate.test.mjs`): tested continuously, every commit. This is what CI proves.
- **A real, windowed Chrome or Edge browser:** untested by CI; the "five-minute human check" above
  is the only thing that has ever exercised one on this app's actual release build, and only when
  someone runs it. Chrome and Edge do provide Web MIDI (`navigator.requestMIDIAccess`), but a
  browser providing the API is not the same as a given keyboard working — a real keyboard silently
  delivering no notes in Chrome is precisely the failure that prompted this checklist. Run step 2.
- **Firefox (desktop):** untested here. Firefox has supported Web MIDI since version 108
  (December 2022), but unlike Chrome it does not use an inline permission dialog: the first
  `requestMIDIAccess()` call asks you to install a generated Site Permission Add-On. If you decline
  it, the app shows "MIDI was blocked here." (`src/app.js:1304`). Nobody has confirmed that flow, or
  the microphone path, end-to-end in Firefox.
- **Safari (desktop and iOS):** untested, and Web MIDI is not available — the app detects the
  missing API and says so, falling back to on-screen keys, computer-keyboard keys and the
  microphone rather than failing silently (`src/app.js:1289`). That fallback has not been confirmed
  by hand in Safari.
- **iPhone/iPad (the "Phone copy" edition):** unmeasured — see "Phone copy" above. Do not tell a
  learner it works on their phone.
- **Real MIDI keyboards, real instruments through a real microphone:** untested beyond whichever
  specific hardware someone last ran the checklist above on — never claim broader hardware
  coverage than that.

## Licence

Apache-2.0 — see `LICENSE`.
