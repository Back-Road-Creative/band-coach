// Pure helpers and constants shared by the song importers (import-abc.js,
// import-gp5.js, import-gp7.js, import-midi.js, import-musicxml.js) and
// export-abc.js. No imports, no DOM: only pieces that were byte-identical
// across those files. Decoders and key-signature mappers stay per-importer.

export const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
// Tempo an importer falls back to when the source file carries none.
export const IMPORT_DEFAULT_BPM = 120;

export function midiFromStep(step, octave, alter) {
  return (octave + 1) * 12 + STEP_PC[step] + alter;
}

export function num(str, fallback) {
  if (str === undefined || str === null || str === '') return fallback;
  const n = Number(str);
  return Number.isFinite(n) ? n : fallback;
}
