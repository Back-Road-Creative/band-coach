# Capability and maturity matrix

One row per instrument record (`src/instruments/*.js`, via `src/instruments/index.js`), generated
by `src/instruments/capability.js`'s `capabilityFor()` — never hand-typed. `tests/unit/capability-matrix.test.mjs`
parses this table and fails the suite if a cell here ever drifts from what that function actually
computes, so this table cannot go stale without a red test telling you.

Columns: `practise` — can a learner work a curriculum level on this instrument today. `assess` — how a
performance is actually checked: `midi` (an exact MIDI note), `mic-single-note` (the microphone's
monophonic pitch detector, one note at a time), `tap` (rhythm-only, no pitch), or `none` (not
assessable yet). `chart` — the "how to play it" diagram: `computed` (a formula, always correct for
any in-range note — fretboard, fingerboard, brass valves/slide, harmonica, keyboard), `typed-unreviewed` (a
hand-typed lookup table or drawn layout no musician has checked), `typed-reviewed` (same, but
checked — none today), or `none` (no diagram at all; voice, the wind/brass picker and
mallet percussion give a curriculum and pitch matching with no fingering panel). `contentReviewed` —
straight from `src/instruments/review.js`'s `isReviewed()`: has a real musician checked this
record's curriculum against a method book, from its `provenance` field. `tier` — the maturity label
below. A review can go stale: when `provenance.contentRev` is set, `isReviewCurrent()` only counts
the review as current while `reviewedRev` matches it, so an edited curriculum stops reading as
reviewed until it's checked again.

**A record's internal `status: 'ready'` means the code path is wired up and runnable — it is never
an educational-validation badge.** Every instrument below is `status: 'ready'` (the app has no
`planned` record today), and every one still carries `contentReviewed: false`: nothing here has yet
been checked by a musician against a method book or teaching standard.

## Tiers

- **first-release-candidate** — `status: 'ready'` and `input` is exactly `'midi'`: a complete,
  assessed pathway. Only the keyboard qualifies today.
- **supported-untested** — `status: 'ready'` and `input` is `'mic+midi'`: MIDI assessment exists,
  but the record's mic path is onset-only (no real pitch) and no e-kit has actually been tried
  against this app. Only the drum kit qualifies today.
- **accessible-unvalidated** — `status: 'ready'`, mic-only or tap: practisable today, but nothing
  about its chart or curriculum content has been checked by a musician.
- **planned** — `status: 'planned'`: not yet practisable or assessable at all. No record is in this
  tier today.

## The matrix

| id | name | practise | assess | chart | contentReviewed | tier |
| --- | --- | --- | --- | --- | --- | --- |
| kbd | Keyboard | true | midi | computed | false | first-release-candidate |
| gtr | Guitar | true | mic-single-note | computed | false | accessible-unvalidated |
| bass | Bass | true | mic-single-note | computed | false | accessible-unvalidated |
| uke | Ukulele | true | mic-single-note | computed | false | accessible-unvalidated |
| voice | Voice | true | mic-single-note | none | false | accessible-unvalidated |
| wind | Wind and brass (choose your instrument) | true | mic-single-note | none | false | accessible-unvalidated |
| harp | Harmonica | true | mic-single-note | computed | false | accessible-unvalidated |
| violin | Violin | true | mic-single-note | computed | false | accessible-unvalidated |
| viola | Viola | true | mic-single-note | computed | false | accessible-unvalidated |
| cello | Cello | true | mic-single-note | computed | false | accessible-unvalidated |
| double-bass | Double bass | true | mic-single-note | computed | false | accessible-unvalidated |
| mandolin | Mandolin | true | mic-single-note | computed | false | accessible-unvalidated |
| banjo-5-string | 5-string banjo | true | mic-single-note | computed | false | accessible-unvalidated |
| ukulele-baritone | Baritone ukulele | true | mic-single-note | computed | false | accessible-unvalidated |
| ukulele-low-g | Low-G ukulele | true | mic-single-note | computed | false | accessible-unvalidated |
| bass-5-string | 5-string bass | true | mic-single-note | computed | false | accessible-unvalidated |
| trumpet-bb | Trumpet (B flat) | true | mic-single-note | computed | false | accessible-unvalidated |
| clarinet-bb | Clarinet (B flat) | true | mic-single-note | typed-unreviewed | false | accessible-unvalidated |
| sax-alto-eb | Alto sax (E flat) | true | mic-single-note | typed-unreviewed | false | accessible-unvalidated |
| sax-tenor-bb | Tenor sax (B flat) | true | mic-single-note | typed-unreviewed | false | accessible-unvalidated |
| flute | Flute | true | mic-single-note | typed-unreviewed | false | accessible-unvalidated |
| horn-f | French horn (F) | true | mic-single-note | computed | false | accessible-unvalidated |
| trombone | Trombone | true | mic-single-note | computed | false | accessible-unvalidated |
| recorder-descant | Descant recorder | true | mic-single-note | typed-unreviewed | false | accessible-unvalidated |
| tin-whistle | Tin whistle (D) | true | mic-single-note | typed-unreviewed | false | accessible-unvalidated |
| oboe | Oboe | true | mic-single-note | typed-unreviewed | false | accessible-unvalidated |
| mallet-percussion | Mallet percussion (bells) | true | mic-single-note | none | false | accessible-unvalidated |
| drum-kit | Drum kit | true | midi | typed-unreviewed | false | supported-untested |

## Measured detection figures

What the test suite actually measures about note detection today. Every number below is printed by
the command shown; none is typed from memory, and none comes from a real microphone, a real room or
a real instrument. They are regression floors on synthetic input, not a validated accuracy claim.

**Reproduce:** `npm run build && node --test tests/unit/multipitch.test.mjs tests/unit/eval-roundtrip.test.mjs`

**Polyphonic detector, rendered audio** (`tests/unit/multipitch.test.mjs`): the two-voice
"Hot Cross Buns" starter song is rendered to audio samples and run through the multi-pitch tracker.

| Measure | Value |
| --- | --- |
| Precision | 0.8500 |
| Recall | 1.0000 |
| F1 | 0.9189 |
| Reference notes matched | 34 of 34 |
| Notes estimated | 40 |

**Song transcription, synthetic pitch frames** (`tests/unit/eval-roundtrip.test.mjs`): each starter
song is turned into a synthetic frame-by-frame pitch track (not audio), transcribed, and scored
against the song's own notes. Each family row applies that family's own made-up wobble and glide
settings; it is not a measurement of any real instrument. Mean F1 over the nine starter songs:

| Rendering profile | Mean F1 |
| --- | --- |
| keys family | 0.848 |
| fretted family | 0.848 |
| bowed family | 0.808 |
| wind family | 0.808 |
| brass family | 0.808 |
| free-reed family | 0.848 |
| voice family | 0.785 |

Per starter song (keys profile), F1 with matched / reference / estimated notes: Hot Cross Buns
0.741 (10 of 17, 10 estimated); Mary Had a Little Lamb 0.791 (17 of 26, 17); Au clair de la lune
0.842 (8 of 11, 8); Twinkle, Twinkle, Little Star 0.727 (24 of 42, 24); Frère Jacques 0.933 (28 of
32, 28); London Bridge Is Falling Down 0.979 (23 of 24, 23); Ode to Joy (theme) 0.824 (21 of 30,
21); Amazing Grace (New Britain) 0.824 (14 of 17, 17); Minuet in G 0.968 (30 of 32, 30).

**Not measured, so no figure is given:**

- Live microphone precision and recall for any instrument. The microphone tests in
  `tests/unit/mic-*.test.mjs` check error wording and the noise-gate message, and print no
  precision or recall. The monophonic mic path (the `mic-single-note` rows above) has no
  precision or recall measurement.
- Abstention (how often the detector declines to answer instead of guessing, on silence, noise or
  a wrong note). No test counts it. The only place the code abstains by name is the room check
  (`src/audio/levels.js`), which declines to store a noise floor when it hears playing; that has
  pass/fail tests but no rate.
- Drum-kit microphone input: onset-only, no pitch, no figure.
- Anything on a real phone microphone (see Promises below).

Until a measured live-microphone harness exists, read every `mic-single-note` row as practice-grade
detection, as the First release section already says.

## First release (assumed, JP to confirm)

This section is a working assumption for what "first release" targets, not a decision — **JP to
confirm** before it drives any external claim:

- Learners: beginner adults and teens.
- Platform: offline desktop Chrome or Edge (README.md's "Get it" / "Open it in Chrome or Edge").
- Assessed paths at first release: a MIDI keyboard, and the on-screen/computer-key equivalent for
  it — the only `first-release-candidate` row above.
- Microphone paths (every `accessible-unvalidated` row) ship as practice-grade, single-note
  detection — real and usable, but not held to the same validated bar as the MIDI keyboard path,
  and never presented as "assessed" in the stronger sense.
- The drum kit's e-kit/MIDI path is real code with no confirmed run against actual e-kit hardware —
  `supported-untested`, not a first-release-candidate, until that evidence exists.

## Promises

Each older promise this repo makes, checked against what actually ships, one line per promise —
only promises this doc can point at a real line for.

| Promise | Source | Status |
| --- | --- | --- |
| "Free, no account, and your sound never leaves your computer" | README.md:6 | implemented-and-verified — `tests/build/pages-offline.test.mjs`, `tests/release/gate.test.mjs` drive the release build offline and assert zero network calls |
| A learner can turn a recording of themselves (or an audio file) into a playable song | README.md:470 ("its file input lets a learner pick a recording") | implemented-and-verified — `tests/unit/capture-v2-transcribe.test.mjs`, `tests/unit/eval-roundtrip.test.mjs` |
| Installable "phone copy" / Add to Home Screen (README.md's "Phone copy" section) | README.md:1493-1500 | implemented-and-verified for install/offline-render only — `tests/build/pages.test.mjs`, `tests/build/pages-offline.test.mjs` prove the service worker installs and the shell renders offline in headless Chromium |
| The phone copy works on a real phone, microphone included | README.md:1512-1517 ("**iPhone microphone behaviour is unmeasured** ... don't tell a learner it works on their phone") | deliberately-deferred — README.md states this outright: unmeasured on a real device, a later test phase is planned |
| Every instrument's curriculum/chart has been checked by a musician | README.md:808-809 ("that badge is visible for all 28 instruments today, not a rare edge case") | planned — README.md's own words: `provenance: null` everywhere today; this doc's `contentReviewed: false` on every row is the same fact, generated |
| 28 instruments modeled as data records | README.md:809, confirmed by `src/instruments/index.js`'s 28-entry `INSTRUMENTS` array | implemented-and-verified — `tests/unit/instruments.test.mjs` validates every record against the schema |
| "Learn any song" (no such claim found) | — | not found — this doc did not locate a README/docs/journeys promise reading "any song" as a repertoire claim; "Opening any song" (README.md:558) describes the song-list UI, not a repertoire guarantee, so it is not listed as a promise here |
