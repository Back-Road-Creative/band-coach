import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { itemIdForMidi, mapMasteryKeys } from '../../src/ui/songs/mastery.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = join(__dirname, '..', '..', 'src', 'app.js');

test('kbd maps a midi note straight to n<midi> when in range', () => {
  assert.equal(itemIdForMidi('kbd', 60, {}), 'n60');
});

test('kbd folds an out-of-range note into the drill range 48-72', () => {
  assert.equal(itemIdForMidi('kbd', 36, {}), 'n48');
  assert.equal(itemIdForMidi('kbd', 84, {}), 'n72');
});

test('gtr/bass/uke map to a pitch-class item, any octave', () => {
  assert.equal(itemIdForMidi('gtr', 64, {}), 'p4');
  assert.equal(itemIdForMidi('bass', 40, {}), 'p4');
  assert.equal(itemIdForMidi('uke', 76, {}), 'p4');
});

test('the five newer fretted instruments map to a pitch-class item, any octave, same as gtr/bass/uke', () => {
  assert.equal(itemIdForMidi('mandolin', 62, {}), 'p2');
  assert.equal(itemIdForMidi('banjo-5-string', 50, {}), 'p2');
  assert.equal(itemIdForMidi('bass-5-string', 23, {}), 'p11');
  assert.equal(itemIdForMidi('ukulele-baritone', 50, {}), 'p2');
  assert.equal(itemIdForMidi('ukulele-low-g', 55, {}), 'p7');
});

test('mallet-percussion maps a midi note straight to n<midi> when in its own 60-84 range', () => {
  assert.equal(itemIdForMidi('mallet-percussion', 60, {}), 'n60');
  assert.equal(itemIdForMidi('mallet-percussion', 84, {}), 'n84');
});

test('mallet-percussion folds an out-of-range note into its own range, not kbd\'s', () => {
  // 85 is one semitone above mallet-percussion's own high (84): folding
  // through its own range gives 'n73' (85-12). Folding it through kbd's
  // 48-72 range instead (the bug this test guards against) would wrongly
  // give 'n61' (85-12-12).
  assert.equal(itemIdForMidi('mallet-percussion', 85, {}), 'n73');
  assert.equal(itemIdForMidi('mallet-percussion', 96, {}), 'n84');
  assert.equal(itemIdForMidi('mallet-percussion', 49, {}), 'n61');
});

test('every status:\'ready\' instrument record maps a note in its own range to a non-null id', () => {
  const ready = INSTRUMENTS.filter(rec => rec.status === 'ready');
  // Sanity check on the fixture itself: this is the regression this test
  // exists to catch, so make sure it is actually exercising more than a
  // couple of records.
  assert.ok(ready.length >= 13, `expected at least 13 ready records, found ${ready.length}`);
  for (const rec of ready) {
    // "a note" (singular), not "every note": harp is a diatonic instrument
    // whose 10 holes cover only 7 of the 12 pitch classes in its range (its
    // own middle-C hole, hole 4 blow, is midi 72 -- see mastery.js's
    // HARP_BLOW/HARP_DRAW) -- the five missing pitch classes legitimately
    // have no hole and are expected to stay null.
    const span = rec.range.high - rec.range.low + 1;
    let mapped = 0;
    for (let midi = rec.range.low; midi <= rec.range.high; midi++) {
      if (itemIdForMidi(rec.id, midi, {}) !== null) mapped++;
    }
    assert.ok(mapped > 0, `${rec.id} (status ready) mapped nothing across its own range [${rec.range.low}, ${rec.range.high}]`);
    // Every non-diatonic ready instrument (everything but harp) should map
    // EVERY note in its own range, not just one.
    if (rec.id !== 'harp') {
      assert.equal(mapped, span, `${rec.id} (status ready) mapped only ${mapped}/${span} notes in its own range [${rec.range.low}, ${rec.range.high}]`);
    }
  }
});

test('customItem in src/app.js delegates to itemIdForMidi (single source of truth)', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  assert.match(src, /import \{ itemIdForMidi \} from '\.\/ui\/songs\/mastery\.js';/,
    'app.js must import itemIdForMidi from the mastery module');
  assert.match(src, /function customItem\(m, midi, prefs\) \{\s*return itemIdForMidi\(m, midi, prefs\);\s*\}/,
    'customItem must delegate to itemIdForMidi rather than re-implementing the instrument-id scheme');
});

test('tickGroove folds to pitch class for every fretted instrument, not just gtr/bass/uke', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  // gtr/bass/uke are mic-only fretted instruments: the mic can hear a
  // pitch but not which string produced it, so a groove/rhythm take is
  // scored by pitch class regardless of octave. mandolin, banjo-5-string,
  // bass-5-string, ukulele-baritone and ukulele-low-g are wired through the
  // identical stringLevels() curriculum and the same mic ambiguity, so the
  // old hand-typed ['gtr', 'bass', 'uke'] list silently scored a correct
  // take on those five as wrong. The predicate must be derived from the
  // registry's `fretted` flag instead of a second hand-typed instrument-id
  // list.
  assert.doesNotMatch(src, /const fold = \['gtr', 'bass', 'uke'\]\.indexOf\(mod\)/,
    'tickGroove must not hand-type a fretted-instrument id list a second time');
  assert.match(src, /const fold = \(instrumentById\[mod\] && instrumentById\[mod\]\.fretted\) \|\| task\.els\.some\(e => e\.info\.anywhere\);/,
    'tickGroove\'s fold predicate must derive from instrumentById[mod].fretted');
});

test('the captured-melody checkbox is gated on customItem actually mapping this mod, not a hand-typed list', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  assert.doesNotMatch(src, /\['kbd', 'gtr', 'bass', 'uke', 'voice', 'wind', 'harp'\]\.indexOf\(mod\) >= 0\) chk\('optCustom'/,
    'the optCustom checkbox must not hand-type the seven original ready instrument ids a second time');
  assert.match(src, /if \(MODS\[mod\] && DB\.custom && DB\.custom\.length && hasMasteryScheme\(mod\)\) chk\('optCustom'/,
    'the optCustom checkbox must gate on hasMasteryScheme(mod), which asks customItem() directly');
});

// The checkbox and the dropdown are two halves of ONE feature: the capture
// tool's "Practise on" list chooses where a captured melody goes, and the
// per-instrument checkbox turns it on once you are there. Gating them on
// different rules ships the feature broken in the visible direction —
// the checkbox appears for an instrument the dropdown never offered.
test('the capture tool\'s "Practise on" list is gated the same way the checkbox is', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  assert.doesNotMatch(src, /MOD_IDS\.filter\(m => \['kbd', 'gtr', 'bass', 'uke', 'voice', 'wind', 'harp'\]\.indexOf\(m\) >= 0\)/,
    'the capTo dropdown must not hand-type the seven original ready instrument ids a third time');
  assert.match(src, /MOD_IDS\.filter\(m => hasMasteryScheme\(m\)\)/,
    'the capTo dropdown must offer exactly the mods hasMasteryScheme() accepts');
});

test('hasMasteryScheme agrees with itemIdForMidi for every mod id, including the six newly-ready instruments', () => {
  const src = readFileSync(APP_JS_PATH, 'utf8');
  assert.match(src, /function hasMasteryScheme\(mod\) \{/, 'app.js must define hasMasteryScheme(mod)');
  for (const id of ['mandolin', 'banjo-5-string', 'bass-5-string', 'ukulele-baritone', 'ukulele-low-g', 'mallet-percussion']) {
    const rec = INSTRUMENTS.find(r => r.id === id);
    assert.notEqual(itemIdForMidi(id, rec.range.low, {}), null, `${id}: itemIdForMidi should map its own range.low`);
  }
});

test('voice maps to a scale degree from the preferred tonic', () => {
  assert.equal(itemIdForMidi('voice', 48, { voice: 'low' }), 'v0'); // low Do = C3 = 48
  assert.equal(itemIdForMidi('voice', 55, { voice: 'mid' }), 'v0'); // mid Do = G3 = 55
  assert.equal(itemIdForMidi('voice', 62, { voice: 'mid' }), 'v7'); // a fifth above mid Do
  assert.equal(itemIdForMidi('voice', 48, {}), 'v0'); // default preference is 'low'
});

test('wind maps a concert-pitch midi note to the written item for the chosen transposition', () => {
  // B-flat trumpet (default): written = concert + 2.
  assert.equal(itemIdForMidi('wind', 60, { wind: 'bb' }), 'w62');
  assert.equal(itemIdForMidi('wind', 60, {}), 'w62'); // default preference is 'bb'
  // Bass-clef trombone: written = concert + 19.
  assert.equal(itemIdForMidi('wind', 41, { wind: 'bc' }), 'w60');
});

test('harp maps a concert pitch to the first matching hole in search order 4,5,6,7,3,2,1,8,9,10, blow before draw', () => {
  // pitch class 0 (C): hole 4 blow is C5=72 (pc 0) -- the first hit in
  // search order, even though hole 1 blow (C4=60) is also pc 0.
  assert.equal(itemIdForMidi('harp', 60, {}), 'hb4');
  // pitch class 2 (D): hole 4 blow (pc 0) misses, hole 4 draw is E5=74 (pc 2).
  assert.equal(itemIdForMidi('harp', 62, {}), 'hd4');
  // pitch class 7 (G): hole 4/5 (blow+draw) miss, hole 6 blow is G5=79 (pc 7).
  assert.equal(itemIdForMidi('harp', 67, {}), 'hb6');
});

test('planned instruments with no drill curriculum return null', () => {
  // As of this commit every wind record in src/instruments/*.js (flute,
  // clarinet-bb, oboe, sax-alto-eb, sax-tenor-bb) is 'ready' -- see the
  // dedicated woodwind mastery test below -- so there is no longer a
  // planned instrument id in the registry to stand in here. The default
  // branch's `rec.status !== 'ready'` guard (and its `!rec` guard) is
  // exercised through an id with no registry record at all instead.
  assert.equal(itemIdForMidi('nonexistent-instrument', 60, {}), null);
});

test('trumpet-bb/horn-f/trombone map a concert-pitch midi note to their own fixed-transposition written item, never reading prefs.wind', () => {
  // trumpet-bb: sounding = written - 2, so written = concert + 2.
  assert.equal(itemIdForMidi('trumpet-bb', 60, {}), 'w62');
  assert.equal(itemIdForMidi('trumpet-bb', 60, { wind: 'f' }), 'w62', 'trumpet-bb must not read the generic wind preference');
  // horn-f: sounding = written - 7, so written = concert + 7.
  assert.equal(itemIdForMidi('horn-f', 55, {}), 'w62');
  // trombone: non-transposing, bass-clef 'w' id space is written + 19.
  assert.equal(itemIdForMidi('trombone', 40, {}), 'w59');
});

test('mapMasteryKeys converts creditFor()-shaped keys and drops unmapped ones', () => {
  const masteryKeys = [
    { key: 'midi:60', hit: true },
    { key: 'midi:64', hit: false },
  ];
  assert.deepEqual(mapMasteryKeys(masteryKeys, 'kbd', {}), [
    { id: 'n60', hit: true },
    { id: 'n64', hit: false },
  ]);
  // 'flute' is 'ready' as of this commit (see the dedicated woodwind
  // mastery test below); a nonexistent id stands in here for "this
  // instrument has no mastery scheme to credit".
  assert.deepEqual(mapMasteryKeys(masteryKeys, 'nonexistent-instrument', {}), []);
});

test('the five keyed woodwinds map a written-pitch midi note to their own written item, using each record\'s own transposition', () => {
  // flute/oboe: transposition 0, written = sounding.
  assert.equal(itemIdForMidi('flute', 60, {}), 'w60');
  assert.equal(itemIdForMidi('oboe', 62, {}), 'w62');
  // clarinet-bb: sounding = written - 2, so written = sounding + 2.
  assert.equal(itemIdForMidi('clarinet-bb', 60, {}), 'w62');
  // sax-alto-eb: sounding = written - 9, so written = sounding + 9.
  assert.equal(itemIdForMidi('sax-alto-eb', 58, {}), 'w67');
  // sax-tenor-bb: sounding = written - 14, so written = sounding + 14.
  assert.equal(itemIdForMidi('sax-tenor-bb', 53, {}), 'w67');
});
