// Six folk tunes in the keys they are usually played in (F17), as built-in
// songs for Songs: fiddle, cowboy and parlour tunes that suit a violin, a
// mandolin, a whistle or a harmonica. Same notation, same public-domain
// wording as the beginner tunes in index.js, but kept OUT of starterSongDefs:
// that list feeds the keyboard pathway and ear training, which stay as they
// were. index.js adds the concert B-flat / E-flat versions for band instruments.
import { parse } from './notation.js';
import { PUBLIC_DOMAIN, traditional, composed } from './wording.js';

const folkDefs = [
  {
    id: 'soldiers-joy',
    title: "Soldier's Joy",
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('Scottish/American fiddle reel, in print by the 1770s'),
    key: { tonic: 2, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 90,
    level: 4,
    notation: '^ F#4:e G4:e | A4:e F#4:e D4:e F#4:e A4:e F#4:e D4:e F#4:e | A4:q D5:q D5:q C#5:e B4:e | A4:e F#4:e D4:e F#4:e A4:e F#4:e D4:e F#4:e | G4:q E4:q E4:q F#4:e G4:e | A4:e F#4:e D4:e F#4:e A4:e F#4:e D4:e F#4:e | A4:q D5:q D5:q. G5:e | F#5:e A5:e F#5:e D5:e E5:e G5:e E5:e C#5:e | D5:q D5:q D5:q D5:e E5:e | F#5:e D5:e F#5:e D5:e F#5:e A5:e G5:e F#5:e | E5:e C#5:e E5:e C#5:e E5:e G5:e F#5:e E5:e | F#5:e D5:e F#5:e D5:e F#5:e A5:e G5:e F#5:e | E5:e F#5:e E5:e C#5:e A4:q A4:q | F#5:e D5:e F#5:e D5:e F#5:e A5:e G5:e F#5:e | E5:e C#5:e E5:e C#5:e E5:e G5:e F#5:e E5:e | F#5:e A5:e F#5:e D5:e E5:e G5:e E5:e C#5:e | D5:q D5:q D5:q',
  },
  {
    id: 'irish-washerwoman',
    title: 'The Irish Washerwoman',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('Irish jig, in print by 1792'),
    key: { tonic: 7, mode: 'major' },
    metre: { num: 6, den: 8 },
    bpm: 100,
    level: 4,
    notation: '^ D5:s C5:s | B4:e G4:e G4:e D4:e G4:e G4:e | B4:e G4:e B4:e D5:e C5:e B4:e | C5:e A4:e A4:e E4:e A4:e A4:e | C5:e A4:e C5:e E5:e D5:e C5:e | B4:e G4:e G4:e D4:e G4:e G4:e | B4:e G4:e B4:e D5:e C5:e B4:e | C5:e B4:e C5:e A4:e D5:e D5:e | B4:e G4:e G4:e G4:q G5:s A5:s | B5:e G5:e G5:e D5:e G5:e G5:e | B5:e G5:e B5:e B5:e A5:e G5:e | A5:e F#5:e D5:e A4:e D5:e F#5:e | F#5:e D5:e F#5:e A5:e G5:e F#5:e | E5:e G5:e G5:e D5:e G5:e G5:e | C5:e G5:e G5:e B4:e G5:e G5:e | C5:e B4:e C5:e A4:e D5:e D5:e | B4:e G4:e G4:e G4:q',
  },
  {
    id: 'red-river-valley',
    title: 'Red River Valley',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('North American cowboy song, in print by 1896'),
    key: { tonic: 7, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 120,
    level: 3,
    notation: '^ D4:q G4:q | B4:h B4:h | B4:h A4:q B4:q | A4:q G4:h.~ | G4:h D4:q G4:q | B4:h G4:q B4:q | D5:h C5:q B4:q | A4:w~ | A4:q R:q D5:q C5:q | B4:h B4:q A4:q | G4:h A4:q B4:q | D5:q C5:h. | E4:h F#4:q E4:q | D4:h F#4:q G4:q | A4:h B4:q A4:q | G4:w~ | G4:q R:q',
  },
  {
    id: 'old-joe-clark',
    title: 'Old Joe Clark',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('Appalachian fiddle tune (A mixolydian), in print by 1918'),
    key: { tonic: 9, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 4,
    notation: '^ E5:q | E5:q E5:e F#5:e G5:q G5:e F#5:e | E5:e F#5:e E5:e D5:e C#5:q A4:e C#5:e | E5:q E5:e F#5:e G5:q E5:e G5:e | A5:q A5:q A5:h | E5:q E5:e F#5:e G5:q A5:q | E5:e F#5:e E5:e D5:e C#5:q A4:q | A4:q A4:e C#5:e B4:q G#4:q | A4:w | A4:q A4:e B4:e C#5:e C#5:e D5:e D5:e | E5:e F#5:e E5:e D5:e C#5:q C#5:e B4:e | A4:q A4:e A4:e A4:e B4:e A4:e G4:e | E4:h. R:q | A4:q A4:e B4:e C#5:q D5:e D5:e | E5:e F#5:e E5:e D5:e C#5:q C#5:e B4:e | A4:q A4:e C#5:e B4:q G#4:q | A4:h A4:q',
  },
  {
    id: 'yankee-doodle',
    title: 'Yankee Doodle',
    composer: 'Traditional',
    licence: PUBLIC_DOMAIN,
    source: traditional('American, 18th century'),
    key: { tonic: 10, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 110,
    level: 3,
    notation: 'Bb4:q Bb4:q C5:q D5:q | Bb4:q D5:q C5:q F4:q | Bb4:q Bb4:q C5:q D5:q | Bb4:h A4:h | Bb4:q Bb4:q C5:q D5:q | Eb5:q D5:q C5:q Bb4:q | A4:q F4:q G4:q A4:q | Bb4:h Bb4:h | G4:q. A4:e G4:q F4:q | G4:q A4:q Bb4:h | F4:q. G4:e F4:q Eb4:q | D4:h F4:h | G4:q. A4:e G4:q F4:q | G4:q A4:q Bb4:q G4:q | F4:q Bb4:q A4:q C5:q | Bb4:h Bb4:h',
  },
  {
    id: 'oh-susanna',
    title: 'Oh! Susanna',
    composer: 'Stephen Foster',
    licence: PUBLIC_DOMAIN,
    source: composed('Stephen Foster', 'died 1864; published 1848'),
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    level: 3,
    notation: '^ C5:e D5:e | E5:q G5:q G5:q. A5:e | G5:q E5:q C5:q. D5:e | E5:q E5:q D5:q C5:q | D5:h. C5:e D5:e | E5:q G5:q G5:q. A5:e | G5:q E5:q C5:q. D5:e | E5:q E5:q D5:q D5:q | C5:h. R:q | F5:h F5:h | A5:q A5:h A5:q | G5:q G5:q E5:q C5:q | D5:h. C5:e D5:e | E5:q G5:q G5:q. A5:e | G5:q E5:q C5:q. D5:e | E5:q E5:q D5:q D5:q | C5:h.',
  },
];

export const starterFolkTunes = folkDefs.map((def) => parse(def.notation, def));

