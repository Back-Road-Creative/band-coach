// Instruments-as-data: every record here is validated by schema.js's
// validateInstrument (see tests/unit/instruments.test.mjs). Nothing in
// src/app.js reads this module yet -- that switch-over is a later unit.
import kbd from './kbd.js';
import gtr from './gtr.js';
import bass from './bass.js';
import uke from './uke.js';
import voice from './voice.js';
import wind from './wind.js';
import harp from './harp.js';
import violin from './violin.js';
import viola from './viola.js';
import cello from './cello.js';
import doubleBass from './double-bass.js';
import mandolin from './mandolin.js';
import banjo5String from './banjo-5-string.js';
import ukuleleBaritone from './ukulele-baritone.js';
import ukuleleLowG from './ukulele-low-g.js';
import bass5String from './bass-5-string.js';
import trumpetBb from './trumpet-bb.js';
import clarinetBb from './clarinet-bb.js';
import saxAltoEb from './sax-alto-eb.js';
import saxTenorBb from './sax-tenor-bb.js';
import flute from './flute.js';
import hornF from './horn-f.js';
import trombone from './trombone.js';
import recorderDescant from './recorder-descant.js';
import tinWhistle from './tin-whistle.js';

export const INSTRUMENTS = [
  kbd, gtr, bass, uke, voice, wind, harp,
  violin, viola, cello, doubleBass, mandolin, banjo5String,
  ukuleleBaritone, ukuleleLowG, bass5String,
  trumpetBb, clarinetBb, saxAltoEb, saxTenorBb, flute, hornF, trombone, recorderDescant,
  tinWhistle
];

export const byId = INSTRUMENTS.reduce((acc, rec) => { acc[rec.id] = rec; return acc; }, {});
