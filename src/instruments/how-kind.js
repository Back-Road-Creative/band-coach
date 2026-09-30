// Which src/instruments/how/*.js chart kind an instrument record uses
// (howKindFor) and the id tables behind it. Pure data, no DOM.

// Which brass preset (src/instruments/how/brass.js's PRESETS) an instrument
// record uses, and whether it is valved or slide-based. Only instruments
// this app actually has a record for; euphonium/tuba presets exist in
// brass.js but nothing in src/instruments/*.js models them yet.
export const BRASS_BY_ID = {
  'trumpet-bb': { preset: 'trumpet-cornet', style: 'valves' },
  'horn-f': { preset: 'horn-f-basics', style: 'valves' },
  trombone: { preset: 'trombone', style: 'slide' }
};

// Which src/instruments/how/keyed-woodwind.js chart a keyed Boehm-system
// woodwind record uses (see that file's top comment for the low-confidence
// caveat on every entry -- a good-faith beginner fingering, not verified
// against a real chart or player).
export const KEYED_WOODWIND_CHART_BY_ID = {
  flute: 'flute',
  'clarinet-bb': 'clarinet',
  oboe: 'oboe',
  'sax-alto-eb': 'sax',
  'sax-tenor-bb': 'sax'
};

export function howKindFor(instrument) {
  if (!instrument) return null;
  // A drum `kit` (schema.js) is drawn as the kit itself, whatever the family.
  if (Array.isArray(instrument.kit)) return 'drum-kit';
  if (Array.isArray(instrument.tuning) && instrument.tuning.length > 0) {
    return instrument.fretted === false ? 'fingerboard' : 'fretboard';
  }
  if (instrument.family === 'brass' && BRASS_BY_ID[instrument.id]) {
    return BRASS_BY_ID[instrument.id].style === 'slide' ? 'brass-slide' : 'brass-valves';
  }
  if (instrument.family === 'free-reed') return 'harmonica';
  if (instrument.id === 'recorder-descant') return 'recorder';
  if (instrument.id === 'tin-whistle') return 'whistle';
  if (KEYED_WOODWIND_CHART_BY_ID[instrument.id]) return 'keyed-woodwind';
  if (instrument.family === 'voice') return 'voice';
  return null;
}
