// A starter library of beginner melodies for Band Coach, built entirely
// from public-domain sources: traditional/folk tunes of unknown authorship,
// or melodies by composers who died before 1900. Every entry's `source`
// field states truthfully where the melody comes from and that THIS
// transcription (the notation string below) was made for Band Coach -- it
// does not cite any specific book, edition, or URL.
//
// Wiring-pass API: `starterSongs` is a ready-to-use array of shared-shape
// Song objects (schema 'song/1', see the shared Song shape in
// .data/handoff/band-coach-author-brief.md). `starterSongDefs` is the raw
// tune definitions (including the source notation text) -- kept around so
// tests, and any future editor/importer UI, can inspect or re-render the
// original notation instead of only the flattened note list. Songs are
// ordered easiest first (ascending `level`, 1-4); `level` is a Band-Coach
// convenience field, not part of the shared Song shape itself.
//
// A later wiring pass should treat `starterSongs` as read-only data and
// hand each entry to whatever the app already uses to load a Song (the
// same shape produced by src/song/model.js once that unit lands).

import { parse } from './notation.js';

const PUBLIC_DOMAIN = 'Public domain';

function traditional(origin) {
  return `Traditional ${origin} melody of unknown authorship; this transcription was made for Band Coach.`;
}

function composed(name, note) {
  return `Melody by ${name}${note ? ` (${note})` : ''}; this transcription was made for Band Coach.`;
}

export const starterSongDefs = [
  {
    id: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('English street-cry'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 1,
    notation:
      'E4:q D4:q C4:h | E4:q D4:q C4:h | C4:q C4:q C4:q C4:q | D4:q D4:q D4:q D4:q | E4:q D4:q C4:h',
  },
  {
    id: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('American nursery-rhyme'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 1,
    notation:
      'E4:q D4:q C4:q D4:q | E4:q E4:q E4:h | D4:q D4:q D4:h | E4:q G4:q G4:h | ' +
      'E4:q D4:q C4:q D4:q | E4:q E4:q E4:q E4:q | D4:q D4:q E4:q D4:q | C4:w',
  },
  {
    id: 'au-clair-de-la-lune',
    title: 'Au clair de la lune',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('18th-century French'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 1,
    notation:
      'C4:q C4:q C4:q D4:q | E4:h D4:h | C4:q E4:q D4:q D4:q | C4:w',
  },
  {
    id: 'twinkle-twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('18th-century French ("Ah! vous dirai-je, maman")'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 2,
    notation:
      'C4:q C4:q G4:q G4:q | A4:q A4:q G4:h | F4:q F4:q E4:q E4:q | D4:q D4:q C4:h | ' +
      'G4:q G4:q F4:q F4:q | E4:q E4:q D4:h | G4:q G4:q F4:q F4:q | E4:q E4:q D4:h | ' +
      'C4:q C4:q G4:q G4:q | A4:q A4:q G4:h | F4:q F4:q E4:q E4:q | D4:q D4:q C4:h',
  },
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('French'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 2,
    notation:
      'C4:q D4:q E4:q C4:q | C4:q D4:q E4:q C4:q | E4:q F4:q G4:h | E4:q F4:q G4:h | ' +
      'G4:e A4:e G4:e F4:e E4:q C4:q | G4:e A4:e G4:e F4:e E4:q C4:q | C4:q G3:q C4:h | C4:q G3:q C4:h',
  },
  {
    id: 'london-bridge',
    title: 'London Bridge Is Falling Down',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('English'),
    key: { tonic: 7, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 2,
    notation:
      'G4:q A4:q G4:q F4:q | E4:q F4:q G4:h | D4:q E4:q F4:h | E4:q F4:q G4:h | ' +
      'G4:q A4:q G4:q F4:q | E4:q F4:q G4:h | D4:h G4:h | E4:q C4:h.',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy (theme)',
    composer: 'Ludwig van Beethoven',
    licence: PUBLIC_DOMAIN,
    source: composed('Ludwig van Beethoven', 'died 1827; theme from the Symphony No. 9 finale'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 120,
    level: 3,
    notation:
      'E4:q E4:q F4:q G4:q | G4:q F4:q E4:q D4:q | C4:q C4:q D4:q E4:q | E4:q. D4:e D4:h | ' +
      'E4:q E4:q F4:q G4:q | G4:q F4:q E4:q D4:q | C4:q C4:q D4:q E4:q | D4:q. C4:e C4:h',
  },
  {
    id: 'amazing-grace',
    title: 'Amazing Grace (New Britain)',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('American hymn tune ("New Britain"), first published 1829'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 3, den: 4 },
    bpm: 70,
    level: 3,
    notation:
      '^ G3:q | C4:h E4:e C4:e | E4:h D4:q | C4:h A3:q | G3:h G3:q | ' +
      'C4:h E4:e C4:e | E4:h D4:e E4:e | G4:h',
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G',
    composer: 'Christian Petzold',
    licence: PUBLIC_DOMAIN,
    source: composed(
      'Christian Petzold',
      'died 1733; from the Notebook for Anna Magdalena Bach, long misattributed to J. S. Bach'
    ),
    key: { tonic: 7, mode: 'major' },
    metre: { num: 3, den: 4 },
    bpm: 100,
    level: 4,
    notation:
      'D5:q G4:e A4:e B4:e C5:e | D5:q G4:q G4:q | E5:q C5:e D5:e E5:e F#5:e | G5:q G4:q G4:q | ' +
      'C5:q D5:e C5:e B4:e A4:e | B4:q C5:e B4:e A4:e G4:e | F#4:q G4:e A4:e B4:e G4:e | A4:h.',
  },
  {
    id: 'ode-to-joy-two-hands',
    title: 'Ode to Joy (theme), both hands',
    composer: 'Ludwig van Beethoven',
    licence: PUBLIC_DOMAIN,
    source: composed(
      'Ludwig van Beethoven',
      'died 1827; theme from the Symphony No. 9 finale; left-hand part arranged for Band Coach'
    ),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 4,
    notation:
      'E4:q E4:q F4:q G4:q | G4:q F4:q E4:q D4:q | C4:q C4:q D4:q E4:q | E4:q. D4:e D4:h | ' +
      'E4:q E4:q F4:q G4:q | G4:q F4:q E4:q D4:q | C4:q C4:q D4:q E4:q | D4:q. C4:e C4:h',
    lh:
      'C3:w | G3:w | C3:w | C3:h G3:h | C3:w | G3:w | C3:w | G3:h C3:h',
  },
  {
    id: 'twinkle-twinkle-two-hands',
    title: 'Twinkle, Twinkle, Little Star, both hands',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional(
      '18th-century French ("Ah! vous dirai-je, maman"); left-hand part arranged for Band Coach'
    ),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 90,
    level: 4,
    notation:
      'C4:q C4:q G4:q G4:q | A4:q A4:q G4:h | F4:q F4:q E4:q E4:q | D4:q D4:q C4:h | ' +
      'G4:q G4:q F4:q F4:q | E4:q E4:q D4:h | G4:q G4:q F4:q F4:q | E4:q E4:q D4:h | ' +
      'C4:q C4:q G4:q G4:q | A4:q A4:q G4:h | F4:q F4:q E4:q E4:q | D4:q D4:q C4:h',
    lh:
      'C3:w | F3:h C3:h | F3:h C3:h | G3:h C3:h | C3:h F3:h | C3:h G3:h | C3:h F3:h | C3:h G3:h | ' +
      'C3:w | F3:h C3:h | F3:h C3:h | G3:h C3:h',
  },
];

// Merges the parsed right-hand and (optional) left-hand parses of one
// starter def into a single Song: both hands live in ONE part so the
// existing hand-filter (src/song/hand-filter.js) and kbd hand-off
// (src/instruments/kbd-songs.js) treat the piece the same as any other
// starter -- only note.hand distinguishes the two hands. A stable sort by
// start keeps simultaneous rh/lh onsets in rh-then-lh order, and never
// reorders two notes that already share a start (Array.prototype.sort is
// stable in Node/V8).
function build(def) {
  const song = parse(def.notation, def);
  if (!def.lh) return song;
  const lhSong = parse(def.lh, { ...def, notation: def.lh });
  song.parts[0].notes.forEach((n) => { n.hand = 'rh'; });
  lhSong.parts[0].notes.forEach((n) => { n.hand = 'lh'; });
  song.parts[0].notes = [...song.parts[0].notes, ...lhSong.parts[0].notes].sort((a, b) => a.start - b.start);
  return song;
}

export const starterSongs = starterSongDefs.map(build);

// True when any note in any part of `song` carries an explicit left-hand
// tag -- i.e. the song was built from a def with an `lh` string above. The
// single source of truth for "is this a two-hand piece", used by
// starterMelodies below and available to any later caller that needs the
// same check (e.g. a hand-off UI deciding whether to show a hand selector
// before a real arrangement exists).
export function isTwoHand(song) {
  return song.parts.some((part) => part.notes.some((n) => n.hand === 'lh'));
}

// The subset of starterSongs with no left-hand part: the single pool every
// melody-only consumer (ear song-dictation, song-rhythm, the roundtrip eval
// harness) should read instead of starterSongs, so a two-hand piece is
// never torn apart into a monophonic phrase or graded as if it were one.
export const starterMelodies = starterSongs.filter((s) => !isTwoHand(s));

export default starterSongs;
