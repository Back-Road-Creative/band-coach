// "I can't tell when I'm supposed to hit": every timed exercise now shows the
// beat. Each frame's cue is read through window.__coach.beatCue(), logged by a
// requestAnimationFrame wrapper, so a whole take can be checked afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiRemovePort } from '../helpers/fake-midi.mjs';

const LOG = `
  window.__cues = []; window.__big = new Set(); window.__texts = new Set(); window.__strokes = new Set();
  const st = CanvasRenderingContext2D.prototype.stroke;
  CanvasRenderingContext2D.prototype.stroke = function (...r) { window.__strokes.add(this.strokeStyle); return st.apply(this, r); };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => { cb(ts); const c = window.__coach && window.__coach.beatCue && window.__coach.beatCue(); if (c) window.__cues.push(c); });
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__texts.add(String(s)); const px = parseFloat((this.font.match(/([0-9.]+)px/) || [])[1]); if (px >= 30) window.__big.add(String(s)); return ft.call(this, s, ...r); };
`;
const counted = (cues) => cues.map((c) => c.n).filter((n, i, a) => n != null && n !== a[i - 1]);
const open = async (t, opts = {}) => { const page = await launchPage(HTML_PATH, { initScript: LOG, ...opts }); t.after(() => page.close()); await page.evaluate('window.__coach.db().latencyMs = 0'); return page; };
const start = (page) => page.evaluate("document.getElementById('playBtn').click()");
const take = async (page, kind) => {
  await page.waitFor(`window.__coach.bar() && window.__coach.bar().judged && window.__cues.some(c => c.kind === '${kind}')`, 30000);
  return page.evaluate(`({ cues: window.__cues.filter(c => c.kind === '${kind}'), big: [...window.__big], bar: window.__coach.bar() })`);
};

test('kit: a big beat number counts up through the count-in and the bar', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await start(page);
  const { cues, big, bar } = await take(page, 'kit');
  const beats = bar.countBeats;
  assert.deepEqual(counted(cues).slice(0, beats + 1), [...Array(beats).keys()].map((i) => i + 1).concat(1), 'counts 1.. then starts the bar on 1');
  assert.ok(big.includes(String(beats)), 'the number is drawn big, not just computed');
  assert.deepEqual(page.exceptions, []);
});

test('kit: a line crosses the staff, reaching each note on its beat', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await start(page);
  const { cues, bar } = await take(page, 'kit');
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].sweepX >= cues[i - 1].sweepX, 'the line only moves forward');
  bar.onsets.forEach((o, i) => {
    const near = cues.reduce((a, c) => (Math.abs(c.t - o.t) < Math.abs(a.t - o.t) ? c : a));
    if (Math.abs(near.t - o.t) > 0.05) return; // a frame this close is what the check needs; a slow runner may not have one
    const gap = Math.abs(near.sweepX - near.noteX[i]);
    assert.ok(gap < 40, `note ${i}: the line is ${gap}px from it on the beat`);
  });
});

test('kit: a ring closes on the next drum, and the whole kit no longer lights at once', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await start(page);
  const { cues, bar } = await take(page, 'kit');
  const first = bar.onsets[0];
  const inLead = cues.filter((c) => c.t < first.t && c.t > first.t - bar.spb);
  assert.ok(inLead.length, 'frames in the beat before the first hit');
  for (const p of first.pieces) {
    const prog = inLead.map((c) => (c.rings.find((r) => r.piece === p) || {}).progress).filter((v) => v != null);
    assert.ok(prog.length, p + ' gets a ring');
    assert.ok(prog[prog.length - 1] > prog[0], p + ' ring closes as the hit nears');
  }
  const early = cues.filter((c) => c.t < first.t - 1.5 * bar.spb);
  assert.ok(early.length, 'frames early in the count-in');
  assert.ok(early.every((c) => c.lit.length === 0), 'nothing is filled solid early in the count-in');
});

test('kit: clicks run through the bar with no mic, and stop when an open mic would hear them', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await start(page);
  await page.waitFor('window.__coach.bar() && window.__coach.bar().judged', 30000);
  let bar = await page.evaluate('window.__coach.bar()');
  assert.ok(bar.clicks > bar.countBeats, 'no mic: clicks go past the count-in');

  await page.evaluate('window.__coach.testDrumHit([]); window.__coach.sess().idleBars = 0');
  await page.waitFor('window.__coach.bar() && !window.__coach.bar().judged', 15000);
  await page.waitFor('window.__coach.bar().judged', 30000);
  bar = await page.evaluate('window.__coach.bar()');
  assert.equal(bar.clicks, bar.countBeats, 'an open mic would hear each click as a drum hit');
});

// A MIDI note proves an e-kit is what is being played: the mic then only hears
// the pads and the clicks, so it stops counting and the clicks are safe again.
// Unplugging the kit hands the count back to the mic.
test('kit: a real MIDI hit stops the mic counting and brings the clicks back, until it is unplugged', async (t) => {
  const page = await open(t, { initScript: FAKE_MIDI_INIT + LOG });
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.evaluate("document.getElementById('setupBtn').click()");
  await midiAddPort(page, 'kit', 'Fake Kit');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("window.__midiPorts.get('kit').onmidimessage", 5000);
  await page.evaluate('window.__coach.testDrumHit([])');
  await start(page);
  await page.waitFor("window.__coach.bar() && window.__coach.audioNow() >= window.__coach.bar().playAt", 15000);
  const micHit = "(() => { const b = window.__coach.bar(), n = b.taps.length; window.__coach.kitHit('kick', window.__coach.audioNow(), 'mic'); return b.taps.length - n; })()";
  assert.equal(await page.evaluate(micHit), 1, 'before any MIDI note, a mic hit counts');
  const midiHit = "(() => { const b = window.__coach.bar(), n = b.taps.length; window.__midiSend('kit', [0x90, 36, 100]); return b.taps.length - n; })()";
  assert.equal(await page.evaluate(midiHit), 1, 'the pad itself counts');
  assert.equal(await page.evaluate(micHit), 0, 'the mic only hears the pads now');

  await page.waitFor('window.__coach.bar().judged', 30000);
  await page.evaluate('window.__coach.sess().idleBars = 0');
  await page.waitFor('window.__coach.bar() && !window.__coach.bar().judged', 15000);
  await page.waitFor('window.__coach.bar().judged', 30000);
  const bar = await page.evaluate('window.__coach.bar()');
  assert.ok(bar.clicks > bar.countBeats, 'clicks are back');

  await midiRemovePort(page, 'kit');
  await page.evaluate('window.__coach.sess().idleBars = 0');
  await page.waitFor('window.__coach.bar() && !window.__coach.bar().judged && window.__coach.audioNow() >= window.__coach.bar().playAt', 15000);
  assert.equal(await page.evaluate(micHit), 1, 'the kit is gone: the mic counts again');
  assert.deepEqual(page.exceptions, []);
});

test('kit: the cues run on the judge\'s clock, so calibrated latency moves them too', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.evaluate('window.__coach.db().latencyMs = 300');
  await start(page);
  await page.waitFor('window.__coach.beatCue() && window.__coach.beatCue().kind === "kit"', 15000);
  const lag = await page.evaluate('window.__coach.audioNow() - window.__coach.beatCue().t');
  assert.ok(lag > 0.25 && lag < 0.6, 'cue clock lags the audio clock by the latency, got ' + lag);
});

test('kit, reduced motion: no sliding line or closing ring, the next drum just lights', async (t) => {
  const page = await open(t, { reducedMotion: true });
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await start(page);
  const { cues, bar } = await take(page, 'kit');
  const positions = new Set(cues.map((c) => c.sweepX));
  assert.ok(positions.size <= Math.round((bar.end - 0.3 - bar.t0) / bar.spb) + 2, 'the line steps by the beat, got ' + positions.size + ' positions');
  assert.ok(cues.every((c) => c.rings.length === 0), 'no ring is drawn');
  const first = bar.onsets[0], lead = cues.filter((c) => c.t < first.t && c.t > first.t - bar.spb);
  assert.ok(lead.some((c) => first.pieces.every((p) => c.lit.includes(p))), 'the next drum lights instead');
});

test('rhythm reading: the number counts UP and keeps going through the bar', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('rhy')");
  await start(page);
  const { cues } = await take(page, 'bar');
  assert.deepEqual(counted(cues).slice(0, 8), [1, 2, 3, 4, 1, 2, 3, 4]);
  // Seen on screen: the hook reported a line that a stray comment had stopped being drawn.
  assert.ok(await page.evaluate("window.__strokes.has('#f3c52f')"), 'the line is really stroked, in the cue colour');
});

test('rhythm vocabulary: the number counts up and the clicks run through the bar', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('rhy')");
  await page.evaluate('window.__coach.state().level = 9');
  await start(page);
  const { cues, bar } = await take(page, 'bar2');
  assert.deepEqual(counted(cues).slice(0, bar.countBeats), [...Array(bar.countBeats).keys()].map((i) => i + 1));
  assert.ok(bar.clicks > bar.countBeats, 'clicks go past the count-in');
});

test('play in time: pitched instruments get the count, the notes in cells and a line', async (t) => {
  const page = await open(t);
  await page.evaluate("window.__coach.setMod('kbd')");
  await start(page);
  await page.evaluate('window.__coach.grooveOn(true)');
  await page.waitFor("window.__coach.task() && window.__coach.task().kind === 'groove' && window.__coach.groove()", 5000);
  await page.waitFor('window.__coach.groove().judged', 30000);
  const { cues, grid, spb } = await page.evaluate("({ cues: window.__cues.filter(c => c.kind === 'groove'), grid: window.__coach.groove().grid, spb: window.__coach.groove().spb })");
  assert.deepEqual(counted(cues).slice(0, 8), [1, 2, 3, 4, 1, 2, 3, 4]);
  const { labels, texts } = await page.evaluate("({ labels: window.__coach.task().els.map(e => e.info.label.split(':')[0]), texts: [...window.__texts] })");
  for (const label of labels) assert.ok(texts.includes(label), label + ' is written in its cell');
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].sweepX >= cues[i - 1].sweepX, 'the line only moves forward');
  assert.deepEqual([...new Set(cues.map((c) => c.cell).filter((c) => c != null))], [0, 1, 2, 3], 'each note lights in turn');
  const onBeat = cues.filter((c) => c.t >= grid[1] && c.t < grid[1] + spb * 0.4);
  assert.ok(onBeat.every((c) => c.cell === 1), 'the second note is lit on its beat');
  assert.deepEqual(page.exceptions, []);
});
