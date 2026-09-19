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
    id: 'three-blind-mice',
    title: 'Three Blind Mice',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('English nursery-rhyme'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 1,
    notation:
      'E4:q D4:q C4:h | E4:q D4:q C4:h | G4:q F4:q E4:h | G4:q F4:q E4:h | E4:q D4:q C4:h',
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
      'C4:q C4:q C4:q D4:q | E4:h D4:h | C4:q E4:q D4:q C4:q | D4:q D4:q D4:q D4:q | D4:h C4:h',
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
      'G4:q A4:q G4:q F4:q | E4:q C4:q E4:q C4:q | C4:q G3:q C4:h',
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
      'G4:q A4:q G4:q F4:q | E4:q F4:q G4:h | G4:q A4:q G4:q F4:q | E4:q F4:q G4:h | ' +
      'D4:q E4:q F4:q G4:q | D4:q E4:q F4:h | G4:q A4:q G4:q F4:q | E4:q F4:q G4:h',
  },
  {
    id: 'row-row-row-your-boat',
    title: 'Row, Row, Row Your Boat',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('American'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 2,
    notation:
      'C4:q C4:q C4:q D4:q | E4:q E4:q D4:q E4:q | F4:h G4:h | C5:q C5:q C5:q G4:q | ' +
      'G4:q G4:q E4:q E4:q | E4:q C4:q C4:q C4:q | G4:q F4:q E4:q D4:q | C4:w',
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
      'E4:q E4:q F4:q G4:q | G4:q F4:q E4:q D4:q | C4:q C4:q D4:q E4:q | D4:h C4:h',
  },
  {
    id: 'oh-susanna',
    title: 'Oh! Susanna',
    composer: 'Stephen Foster',
    licence: PUBLIC_DOMAIN,
    source: composed('Stephen Foster', 'died 1864; published 1848'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 130,
    level: 3,
    notation:
      'C4:q E4:q E4:q D4:q | C4:q D4:q E4:h | E4:q F4:q G4:q A4:q | G4:h E4:h | ' +
      'C5:q C5:q A4:q G4:q | F4:q E4:q D4:h | C4:q E4:q G4:q A4:q | G4:w',
  },
  {
    id: 'aura-lee',
    title: 'Aura Lee',
    composer: 'George R. Poulton',
    licence: PUBLIC_DOMAIN,
    source: composed('George R. Poulton', 'died 1867; published 1861, words by W. W. Fosdick'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 3, den: 4 },
    bpm: 90,
    level: 3,
    notation: 'C4:q E4:q G4:q | A4:q G4:q E4:q | F4:q D4:q F4:q | E4:h.',
  },
  {
    id: 'simple-gifts',
    title: 'Simple Gifts',
    composer: 'Joseph Brackett',
    licence: PUBLIC_DOMAIN,
    source: composed('Joseph Brackett', 'died 1882; Shaker song, 1848'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 110,
    level: 3,
    notation: 'C4:q F4:q G4:q A4:q | G4:h. F4:q | F4:q D4:q E4:q F4:q | C4:w',
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
    notation: '^ G4:q | C4:q. E4:e G4:q | E4:q. C4:e E4:q | D4:q. C4:e D4:q | C4:h',
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
    notation: 'D4:q G4:q A4:q | B4:q C5:q D5:q | G4:h. | G4:q F#4:q E4:q | D4:h.',
  },
  {
    id: 'brahms-lullaby',
    title: "Brahms' Lullaby",
    composer: 'Johannes Brahms',
    licence: PUBLIC_DOMAIN,
    source: composed('Johannes Brahms', 'died 1897; "Wiegenlied", Op. 49 No. 4'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 3, den: 4 },
    bpm: 70,
    level: 4,
    notation: 'C4:q C4:q F4:q | F4:q A4:h | G4:q G4:q C5:q | C5:q E5:h',
  },
];

export const starterSongs = starterSongDefs.map((def) => parse(def.notation, def));

export default starterSongs;
