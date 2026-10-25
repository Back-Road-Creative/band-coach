// Drum-kit starter grooves (F20): common practice beats as built-in songs,
// so the drum kit has something in Songs to play -- every pitched starter
// tune fits it at 0 (lesson.js fitToInstrument). Each bar is written in the
// drum trainer's own kit-bar notation (src/instruments/drum-kit.js kitBar)
// and turned into one percussion part: one note per piece per hit, sounding
// the piece's own GM note (canonicalMidi), which is what Songs plays and
// judges (src/ui/songs.js picks the drum kit for a percussion part).
// The title is read live from the locale tables (groove.<id>), the same way
// a kit piece's name is.
import { t } from '../../core/i18n.js';
import { kitBar, canonicalMidi } from '../../instruments/drum-kit.js';
import { CELLS, TPQ } from '../../core/rhythm.js';

const ROCK = 'ee:H+K,H ee:H+S,H ee:H+K,H ee:H+S,H';

const grooveDefs = [
  { id: 'groove-rock', metre: '4/4', bpm: 80, level: 1, bars: [ROCK, ROCK, ROCK, 'ee:H+K,H ee:H+S,H ee:H+K,H+K ee:H+S,H'] },
  { id: 'groove-half-time', metre: '4/4', bpm: 70, level: 1, bars: Array(4).fill('ee:H+K,H ee:H,H ee:H+S,H ee:H,H+K') },
  { id: 'groove-waltz', metre: '3/4', bpm: 90, level: 1, bars: Array(4).fill('q:K+H q:S+H q:S+H') },
  { id: 'groove-four-on-the-floor', metre: '4/4', bpm: 100, level: 2, bars: Array(4).fill('ee:K+H,O ee:K+S+H,O ee:K+H,O ee:K+S+H,O') },
  { id: 'groove-ride', metre: '4/4', bpm: 90, level: 2, bars: Array(4).fill('ee:R+K,R ee:R+S+P,R ee:R+K,R ee:R+S+P,R') },
  { id: 'groove-six-eight', metre: '6/8', bpm: 72, level: 2, bars: ['e3:K+H,H,H e3:S+H,H,H', 'e3:K+H,H,K+H e3:S+H,H,H', 'e3:K+H,H,H e3:S+H,H,H', 'e3:K+H,H,K+H e3:S+H,H,H'] },
  { id: 'groove-sixteenths', metre: '4/4', bpm: 70, level: 3, bars: Array(4).fill('ssss:H+K,H,H,H ssss:H+S,H,H,H ssss:H+K,H,H+K,H ssss:H+S,H,H,H') },
  { id: 'groove-rock-fill', metre: '4/4', bpm: 80, level: 3, bars: [ROCK, ROCK, ROCK, 'ee:H+K,H ee:H+S,H ee:T1,T2 ee:T3,T3'] },
];

// One groove def -> a 'song/1' Song (src/song/model.js validateSong).
function buildGroove(def) {
  const [num, den] = def.metre.split('/').map(Number);
  const notes = [];
  let cursor = 0;
  def.bars.forEach((text) => {
    const { cells, hits } = kitBar(text);
    let h = 0;
    cells.forEach((id) => {
      CELLS[id].forEach((ev) => {
        if (!ev.rest && !ev.tied) {
          const hit = hits[h++];
          if (!hit) throw new Error(`${def.id}: fewer hits than notes in "${text}"`);
          hit.pieces.forEach((piece) => notes.push({ start: cursor, dur: ev.dur, midi: canonicalMidi(piece), piece }));
        }
        cursor += ev.dur;
      });
    });
    if (h !== hits.length) throw new Error(`${def.id}: more hits than notes in "${text}"`);
  });
  return {
    schema: 'song/1',
    id: def.id,
    get title() { return t('groove.' + def.id); },
    composer: null,
    licence: null,
    source: 'A common drum-kit practice groove, written out for Band Coach.',
    key: null,
    metre: { num, den },
    bpm: def.bpm,
    ticksPerQuarter: TPQ,
    level: def.level,
    parts: [{ id: 'kit', name: 'Drum kit', role: 'percussion', notes }],
    chords: [],
  };
}

export const starterGrooves = grooveDefs.map(buildGroove);
