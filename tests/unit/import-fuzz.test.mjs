import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { makeRng } from './audio-analysis-fixtures.mjs';
import { importMidi } from '../../src/song/import-midi.js';
import { importGp5 } from '../../src/song/import-gp5.js';
import { importGp7 } from '../../src/song/import-gp7.js';
import { importMusicXml, importMxl } from '../../src/song/import-musicxml.js';
import { importAbc } from '../../src/song/import-abc.js';
import { readZipEntries, readZipEntryData } from '../../src/song/unzip-lite.js';
import { importProgress } from '../../src/core/progress-file.js';
import { validateSong } from '../../src/song/model.js';

// Seeded corrupt-file sweep. Every importer (and the backup parser) is fed a few hundred
// damaged copies of real fixtures: truncated, bytes flipped, a length or count field
// inflated, a run of zeros spliced in or over the data. A damaged file must either import
// to a Song that passes validateSong, or fail with an Error that has a message the app can
// show. It must never hang, never throw a non-Error, never hand back a half-built Song.
// Every case is a pure function of (BASE_SEED, target, fixture, index); a failure prints
// the seed and strategy so the exact bytes can be rebuilt. Set FUZZ_SEED to explore another
// corner, FUZZ_CASES to run more cases per target.

const BASE_SEED = Number(process.env.FUZZ_SEED) || 0x5eed1e5;
const CASES = Number(process.env.FUZZ_CASES) || 320;
// Wall-clock bound per case, import + validateSong only (not barsOf). The real fixtures
// import in a few milliseconds; a case that needs seconds is a hostile-input hang.
const CASE_BUDGET_MS = 3000;

const fixture = (dir, name) => new Uint8Array(readFileSync(new URL(`../fixtures/${dir}/${name}`, import.meta.url)));
const asText = (bytes) => Buffer.from(bytes).toString('utf8');
const asBytes = (text) => new Uint8Array(Buffer.from(text, 'utf8'));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// ---- byte-level mutations: each takes (bytes, rng) and returns a new Uint8Array ----

function truncate(bytes, rng) { return bytes.slice(0, randInt(rng, 0, Math.max(0, bytes.length - 1))); }

function flipBytes(bytes, rng) {
  const out = bytes.slice();
  for (let n = randInt(rng, 1, 8); n > 0 && out.length; n--) {
    const at = randInt(rng, 0, out.length - 1);
    out[at] = rng() < 0.5 ? out[at] ^ (1 << randInt(rng, 0, 7)) : randInt(rng, 0, 255);
  }
  return out;
}

// Writes a huge 16- or 32-bit value, little or big endian, over a random offset: whichever
// chunk length, count, entry size or string length lives there is now wildly too big.
const HUGE = [0xffffffff, 0x7fffffff, 0x80000000, 0x01000000, 0x00ffffff, 0x0000ffff, 0x00010000];
function inflateLength(bytes, rng) {
  const out = bytes.slice();
  if (out.length < 4) return out;
  const width = rng() < 0.7 ? 4 : 2;
  const at = randInt(rng, 0, out.length - width);
  const value = pick(rng, HUGE) >>> 0;
  const little = rng() < 0.5;
  for (let k = 0; k < width; k++) out[at + (little ? k : width - 1 - k)] = (value >>> (8 * k)) & 0xff;
  return out;
}

function zeroRun(bytes, rng) {
  const len = randInt(rng, 1, 64);
  const at = randInt(rng, 0, bytes.length);
  if (rng() < 0.5) { // splice zeros in, shifting the rest along
    const out = new Uint8Array(bytes.length + len);
    out.set(bytes.subarray(0, at), 0);
    out.set(bytes.subarray(at), at + len);
    return out;
  }
  const out = bytes.slice(); // overwrite with zeros
  out.fill(0, at, Math.min(out.length, at + len));
  return out;
}

// Text formats: the byte-level inflate mostly lands on tag names, so also swap a whole
// digit run (a duration, a divisions value, a repeat count, a tick) for a huge number.
const HUGE_DIGITS = ['99999999999', '2147483648', '4294967296', '65536', '0', '-1', '1e9', '9'.repeat(40)];
function inflateNumber(bytes, rng) {
  const text = asText(bytes);
  const runs = [...text.matchAll(/\d+/g)];
  if (!runs.length) return inflateLength(bytes, rng);
  const m = pick(rng, runs);
  return asBytes(text.slice(0, m.index) + pick(rng, HUGE_DIGITS) + text.slice(m.index + m[0].length));
}

const BINARY = [truncate, flipBytes, inflateLength, zeroRun];
const TEXT = [truncate, flipBytes, inflateNumber, zeroRun];

function mutate(bytes, rng, strategies) {
  const first = strategies[Math.floor(rng() * strategies.length)];
  let out = first(bytes, rng);
  if (rng() < 0.25) out = pick(rng, strategies)(out, rng); // some cases take two hits
  return { bytes: out, label: first.name };
}

// ---- zip helpers (same minimal writer as tests/unit/import-mxl.test.mjs) ----

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
function buildZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data);
    const stored = f.method === 8 ? zlib.deflateRawSync(data) : data;
    const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(f.method), u16(0), u16(0), u32(0), u32(stored.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(head, stored);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(f.method), u16(0), u16(0), u32(0), u32(stored.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += head.length + stored.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
  return new Uint8Array(Buffer.concat([...local, cd, eocd]));
}

function unzipAll(bytes) {
  return readZipEntries(bytes).map((e) => ({ name: e.name, method: e.method, data: readZipEntryData(bytes, e) }));
}

// ---- the contract every case is held to ----

function runCase({ target, fixtureName, index, seed, label }, run, check) {
  const where = `${target} / ${fixtureName} / case ${index} / ${label} / seed ${seed} (FUZZ_SEED=${BASE_SEED})`;
  const started = Date.now();
  let result, thrown, threw = false;
  try { result = run(); } catch (e) { threw = true; thrown = e; }
  if (threw) {
    assert.ok(thrown instanceof Error, `${where}: threw a non-Error: ${String(thrown)}`);
    assert.ok(typeof thrown.message === 'string' && thrown.message.trim() !== '', `${where}: threw an Error with no message`);
  } else {
    check(result, where);
  }
  const ms = Date.now() - started;
  assert.ok(ms < CASE_BUDGET_MS, `${where}: took ${ms} ms (budget ${CASE_BUDGET_MS} ms)`);
  return threw ? 'rejected' : 'imported';
}

function checkSong(result, where) {
  assert.ok(result && typeof result === 'object', `${where}: returned ${String(result)} instead of { song, warnings }`);
  assert.ok(Array.isArray(result.warnings), `${where}: warnings is not an array`);
  const v = validateSong(result.song);
  assert.ok(v.ok, `${where}: imported a Song that fails validateSong: ${JSON.stringify(v.errors).slice(0, 400)}`);
}

// Sweeps `CASES` damaged inputs spread evenly over `seeds` (name -> original bytes).
// `build(bytes)` turns mutated bytes into the importer's input (default: as is).
function sweep(target, seeds, strategies, importer, { build = (b) => b, check = checkSong } = {}) {
  test(`${target}: ${CASES} seeded corrupt files import to a valid Song or fail with a clear Error`, () => {
    const names = Object.keys(seeds);
    const tally = { imported: 0, rejected: 0 };
    const failures = []; // every broken case, so one run shows the whole damage, not just the first
    for (let i = 0; i < CASES; i++) {
      const fixtureName = names[i % names.length];
      const seed = (BASE_SEED + Math.imul(i + 1, 0x9e3779b1) + target.length * 7919) >>> 0;
      const rng = makeRng(seed);
      // Mutation and input construction run outside runCase: a bug there is the harness's,
      // and must not be mistaken for (or hidden as) an importer rejection.
      const m = mutate(seeds[fixtureName], rng, strategies);
      const input = build(m.bytes);
      try {
        tally[runCase({ target, fixtureName, index: i, seed, label: m.label }, () => importer(input), check)]++;
      } catch (e) { failures.push(e.message); }
    }
    assert.equal(failures.length, 0, `${failures.length} of ${CASES} cases broke the contract; first ${Math.min(failures.length, 5)}:\n  ${failures.slice(0, 5).join('\n  ')}`);
    // A sweep that rejects everything (or accepts everything) is not exercising both sides.
    assert.ok(tally.rejected > 0, `${target}: no damaged file was ever rejected (${JSON.stringify(tally)})`);
    assert.ok(tally.imported > 0, `${target}: no damaged file ever still imported (${JSON.stringify(tally)})`);
  });
}

// ---- the sweeps ----

const names = (dir, list) => Object.fromEntries(list.map((n) => [n, fixture(dir, n)]));
const GP7 = ['notes.gp', 'score-info.gp', 'time-signatures.gp'];
const XML = ['tutorial-chopin-prelude.musicxml', 'harmonic-element.musicxml', 'barline-multiple-coda.musicxml'];

sweep('midi', names('midi', ['beat.mid', 'pitchBendTest.mid']), BINARY,
  (b) => importMidi(b, { fileName: 'fuzz.mid' }));

sweep('gp5', names('gp5', ['multitrack.gp5', 'Voices.gp5', 'Repeat.gp5', 'tuplets.gp5']), BINARY,
  (b) => importGp5(b, { fileName: 'fuzz.gp5' }));

sweep('gp7 (damaged zip container)', names('gp7', GP7), BINARY,
  (b) => importGp7(b, { fileName: 'fuzz.gp' }));

// Damage inside the archive: take the real score.gpif, damage it, re-zip it (deflated), so
// the damage reaches the XML reader and the importer instead of stopping at the zip reader.
sweep('gp7 (damaged score.gpif)',
  Object.fromEntries(GP7.map((n) => [n, unzipAll(fixture('gp7', n)).find((e) => e.name === 'Content/score.gpif').data])), TEXT,
  (b) => importGp7(buildZip([{ name: 'Content/score.gpif', method: 8, data: b }]), { fileName: 'fuzz.gp' }),
);

sweep('musicxml', names('musicxml', XML), TEXT, (b) => importMusicXml(asText(b), { fileName: 'fuzz.musicxml' }));

const CONTAINER = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>';
const mxlOf = (xml, method = 8) => buildZip([
  { name: 'META-INF/container.xml', method: 0, data: Buffer.from(CONTAINER) },
  { name: 'score.musicxml', method, data: xml },
]);
sweep('mxl (damaged zip container)',
  Object.fromEntries(XML.map((n, i) => [n, mxlOf(fixture('musicxml', n), i % 2 ? 0 : 8)])), BINARY,
  (b) => importMxl(b, { fileName: 'fuzz.mxl' }));
sweep('mxl (damaged score inside a good zip)', names('musicxml', XML), TEXT,
  (b) => importMxl(mxlOf(b), { fileName: 'fuzz.mxl' }));

const ABC_RICH = [
  'X:1', 'T:Fuzz Seed', 'C:Nobody', 'M:6/8', 'L:1/8', 'Q:1/4=96', 'K:Gmix', '%%score (1 2)',
  'V:1 name="Melody"', 'V:2 name="Bass" clef=bass',
  '[V:1] |:"G"GAB c2d|(3efg [ceg]2z|1 d3 B3:|2 d3 B3|]',
  '[V:2] |:G,3 D,3|C,3 G,,3|1 G,6:|2 G,6|]',
  'w: la la la la',
].join('\n');
sweep('abc', {
  'tune.abc': fixture('acceptance/backup-restore', 'tune.abc'),
  'rich (voices, repeats, tuplet, chords)': asBytes(ABC_RICH),
}, TEXT, (b) => importAbc(asText(b), { fileName: 'fuzz.abc' }));

// The backup parser returns a plain-English refusal rather than throwing, so its contract is
// different: never throw at all, and hand back either { ok: false, error, errorId } or a
// db object and a song list.
function checkBackup(result, where) {
  assert.ok(result && typeof result === 'object', `${where}: returned ${String(result)}`);
  if (result.ok === false) {
    assert.ok(typeof result.error === 'string' && result.error.trim() !== '', `${where}: refusal has no message`);
    assert.ok(typeof result.errorId === 'string' && result.errorId.trim() !== '', `${where}: refusal has no errorId`);
  } else {
    assert.equal(result.ok, true, `${where}: ok is neither true nor false`);
    assert.ok(result.db && typeof result.db === 'object' && !Array.isArray(result.db), `${where}: ok result has no db object`);
    assert.ok(Array.isArray(result.songs), `${where}: ok result has no songs array`);
    assert.ok(result.songs.every((s) => s && typeof s === 'object' && !Array.isArray(s)), `${where}: ok result has a non-object song`);
  }
}
test(`backup: ${CASES} seeded corrupt backup files are refused in plain English or restore a db, never throw`, () => {
  const seeds = names('backups', ['v2-snapshot.json', 'v1-backup.json']);
  const keys = Object.keys(seeds);
  const tally = { ok: 0, refused: 0 };
  const failures = [];
  for (let i = 0; i < CASES; i++) {
    const fixtureName = keys[i % keys.length];
    const seed = (BASE_SEED + Math.imul(i + 1, 0x9e3779b1) + 'backup'.length * 7919) >>> 0;
    const m = mutate(seeds[fixtureName], makeRng(seed), TEXT);
    const where = `backup / ${fixtureName} / case ${i} / ${m.label} / seed ${seed} (FUZZ_SEED=${BASE_SEED})`;
    const started = Date.now();
    let result;
    try {
      result = importProgress(asText(m.bytes));
      checkBackup(result, where);
      assert.ok(Date.now() - started < CASE_BUDGET_MS, `${where}: too slow`);
    } catch (e) { failures.push(e.message.startsWith('backup /') ? e.message : `${where}: importProgress threw ${e && e.message}`); continue; }
    tally[result.ok ? 'ok' : 'refused']++;
  }
  assert.equal(failures.length, 0, `${failures.length} of ${CASES} cases broke the contract; first ${Math.min(failures.length, 5)}:\n  ${failures.slice(0, 5).join('\n  ')}`);
  assert.ok(tally.refused > 0 && tally.ok > 0, `backup: sweep exercised only one side ${JSON.stringify(tally)}`);
});

// A sweep that cannot fail is a bug: prove the harness catches a bad importer.
test('the sweep harness itself: a hang, a non-Error throw and a half-built Song are all caught', () => {
  const ctx = { target: 'self', fixtureName: 'x', index: 0, seed: 1, label: 'none' };
  assert.throws(() => runCase(ctx, () => { throw 'boom'; }, checkSong), /non-Error/);
  assert.throws(() => runCase(ctx, () => { throw new Error(''); }, checkSong), /no message/);
  assert.throws(() => runCase(ctx, () => ({ song: { schema: 'nope' }, warnings: [] }), checkSong), /fails validateSong/);
  assert.throws(() => runCase(ctx, () => ({ song: null }), checkSong), /warnings is not an array/);
  const spin = () => { const end = Date.now() + CASE_BUDGET_MS + 50; while (Date.now() < end); return { song: null, warnings: [] }; };
  assert.throws(() => runCase(ctx, spin, () => {}), /took \d+ ms/);
});

test('the same seed always builds the same damaged bytes', () => {
  const src = fixture('midi', 'beat.mid');
  const a = mutate(src, makeRng(42), BINARY), b = mutate(src, makeRng(42), BINARY);
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.label, b.label);
});
