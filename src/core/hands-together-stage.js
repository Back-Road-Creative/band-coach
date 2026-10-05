// The hands-together grading stage machine (levels 13-17), lifted out of
// app.js's onHandsTogetherNote/onNoteOff so every stage transition can be
// table-tested without a browser. No DOM, no AudioContext: the caller owns
// the clocks (ctx.now = the app's seconds clock for the 0.6s "recent
// note-ons" window, ctx.perfNow = milliseconds for note-on/off timestamps)
// and the held-note ledger (ctx.noteState, ctx.realMidiHeld).
//
// step(ctx, ev) mutates ONLY ctx.pair (the exercise's own scratchpad, as the
// app always did) and returns a verdict, never touching the UI:
//   { acts: [...], held }
//   acts, applied in order: { t: 'fail', msg, key } -> failEl(msg, key);
//     { t: 'pass', q, msg, assist, input } -> passEl(q, msg, assist, input);
//     { t: 'say', msg, cls } -> say(msg, cls); { t: 'refresh' } -> refreshPrompt()
//   held: when not undefined, the caller's recent-note-ons window becomes this array.
// ctx = { id, ex, pair, held, now(), perfNow(), noteState, realMidiHeld, nname(midi) }
// ev  = { type: 'on', midi, exact, source } | { type: 'off', midi, source }
import { handsModeFromId, handsStageFromId, isStagedPairId, fingeringLabel, gradeHandsTogetherExact, gradeHandsTogetherApprox, gradeTimedPair, gradeHeldBass, gradeSplitRhythm, gradePositionChange } from './hands-together.js';

export function step(ctx, ev) {
  const out = { acts: [], held: undefined };
  if (ev.type === 'off') stepOff(ctx, ev, out); else stepOn(ctx, ev, out);
  return out;
}

function stepOn(ctx, ev, out) {
  const { ex, pair, noteState, nname } = ctx, id = ctx.id, midi = ev.midi, source = ev.source, handsMode = handsModeFromId(id);
  const fail = (msg, key) => { out.acts.push({ t: 'fail', msg: msg, key: key }); };
  const pass = (q, msg, assist) => { out.acts.push({ t: 'pass', q: q, msg: msg, assist: assist, input: source }); };
  const say = (msg, cls) => { out.acts.push({ t: 'say', msg: msg, cls: cls }); };
  // The note-on timer window every non-held exact caller uses (screen taps, a mix of sources): push, drop anything older than 0.6s.
  const windowHeld = () => { const t = ctx.now(); out.held = (out.held || ctx.held).concat([{ m: midi, t: t }]).filter(x => ctx.now() - x.t < 0.6); return out.held.map(x => x.m); };
  const clearHeld = () => { out.held = []; };
  const wrongMsg = nname(midi) + ' is not part of ' + ex.short + ' (' + fingeringLabel(ex) + ').';
  if (!ev.exact) {
    const g = gradeHandsTogetherApprox(ex, midi, handsMode);
    if (!g.ok) { if (g.wrong === false) return; fail(nname(midi) + ' is not part of ' + ex.short + ' (approximate: a microphone only hears one note at a time).', id + '>xa' + midi); return; }
    const approxTail = handsMode === 'right' ? 'Right hand checked; the left hand was not.' : handsMode === 'left' ? 'Left hand checked; the right hand was not.' : 'Connect a MIDI keyboard to grade both hands together.';
    pass(0.7, 'Approximate (one note heard, microphone): ' + (g.hand === 'rh' ? 'right' : 'left') + ' hand, ' + nname(midi) + '. ' + approxTail, 'approximate'); return;
  }
  const real = source === 'midi' || source === 'computer-key';
  if (isStagedPairId(id)) {
    const stage = handsStageFromId(id);
    if (stage === 'position') {
      // Untimed. The left hand must stay down across the whole move, so MIDI and computer keys read the true held set; a screen tap falls back to the 0.6s window.
      const heldMidis = real ? noteState.heldPitches() : windowHeld();
      const g = gradePositionChange(ex, heldMidis, pair.moved);
      if (g.oldPosition) { fail('That is the old position -- move your right hand up to ' + nname(ex.rh.midi) + '.', id + '>old'); if (source !== 'midi') clearHeld(); return; }
      if (g.wrong.length) { fail(wrongMsg, id + '>x' + midi); if (source !== 'midi') clearHeld(); return; }
      if (!g.ok) return;
      if (!pair.moved) { pair.moved = true; pair.phase = 'check'; if (source !== 'midi') clearHeld(); say('Good. Now move your right hand up to ' + nname(ex.rh.midi) + ' and play the same shape.', ''); out.acts.push({ t: 'refresh' }); return; }
      pass(undefined, ex.short + ': position change complete. ' + fingeringLabel(ex) + '.'); return;
    }
    if (pair.phase === 'learn') {
      if (real) {
        if (midi !== ex.rh.midi && midi !== ex.lh.midi) { fail(wrongMsg, id + '>x' + midi); pair.learnOn = []; return; }
        pair.learnOn.push(midi);
        const freshHeld = pair.learnOn.filter(m => noteState.isHeld(m));
        const g = gradeHandsTogetherExact(ex, freshHeld, 'both');
        if (g.wrong.length) { fail(wrongMsg, id + '>x' + midi); pair.learnOn = []; return; }
        if (g.ok) {
          pair.phase = 'check'; pair.on = {}; pair.off = {}; pair.notes = []; pair.rhOns = []; pair.rhOffs = [];
          const goLine = stage === 'held' ? 'Good. Now let go, press the bass again and keep holding it, then play the melody over it.' : stage === 'split' ? 'Good. Now let go, then hold the left hand under two even right-hand notes.' : 'Good. Now in time: let go, then press both keys at the same moment and let go together.';
          say(goLine, ''); out.acts.push({ t: 'refresh' });
        }
        return;
      }
      // Screen tap, on-screen Enter/Space or the debug hook: no note-off to time against, so practice only.
      const g = gradeHandsTogetherExact(ex, windowHeld(), 'both');
      if (g.wrong.length) { fail(wrongMsg, id + '>x' + midi); clearHeld(); return; }
      if (g.ok) pass(undefined, ex.short + ': together. Practice only: held notes need a MIDI keyboard or computer keys.', 'guided');
      return;
    }
    // CHECK: only a real note-on counts; a screen tap has no matching note-off.
    if (!real) return;
    if (stage === 'timed') {
      if (midi !== ex.rh.midi && midi !== ex.lh.midi) { fail(wrongMsg, id + '>x' + midi); return; }
      pair.on[midi] = ctx.perfNow(); delete pair.off[midi];
      const g = gradeTimedPair(ex, pair);
      if (g.state === 'fail') { fail(g.reason, id + '>t'); pair.on = {}; pair.off = {}; }
      return;
    }
    if (stage === 'held') {
      if (midi === ex.lh.midi) { pair.on[midi] = ctx.perfNow(); pair.off = {}; pair.notes = []; return; }
      pair.notes.push({ midi: midi, ms: ctx.perfNow(), bassHeld: (ex.lh.midi in pair.on) && noteState.isHeld(ex.lh.midi) });
      const g = gradeHeldBass(ex, { bassOn: pair.on[ex.lh.midi], bassOff: pair.off[ex.lh.midi], notes: pair.notes });
      // A fail while the bass is STILL physically down is only the melody's fault: keep the bass's onset and reset only the melody, so the retry grades from the bass still being held. With the bass already up, reset everything.
      if (g.state === 'fail') { fail(g.reason, id + '>h'); if (noteState.isHeld(ex.lh.midi)) { pair.notes = []; } else { pair.on = {}; pair.off = {}; pair.notes = []; } }
      return;
    }
    if (stage === 'split') {
      if (midi !== ex.rh.midi && midi !== ex.lh.midi) { fail(wrongMsg, id + '>x' + midi); return; }
      if (midi === ex.lh.midi) {
        // Pressing the bass starts the right-hand lists fresh, but only when they are balanced (no right-hand note still down): an early right hand still held is real evidence for this attempt.
        if (pair.rhOns.length === pair.rhOffs.length) { pair.rhOns = []; pair.rhOffs = []; }
        pair.on[midi] = ctx.perfNow(); delete pair.off[midi];
      }
      else if (pair.rhOns.length === pair.rhOffs.length) { pair.rhOns.push(ctx.perfNow()); }
      const g = gradeSplitRhythm(ex, { lhOn: pair.on[ex.lh.midi], lhOff: pair.off[ex.lh.midi], rhOns: pair.rhOns, rhOffs: pair.rhOffs });
      pair.last = { rh: g.rh.state, lh: g.lh.state };
      if (g.state === 'fail') { fail(g.reason, id + '>d'); pair.on = {}; pair.off = {}; pair.rhOns = []; pair.rhOffs = []; }
      return;
    }
    return;
  }
  // Plain/right-only/left-only: real MIDI reads the true held set (a chord held longer than 0.6s still grades); every other exact caller keeps the 0.6s window.
  const heldMidis = source === 'midi' ? Array.from(ctx.realMidiHeld) : windowHeld();
  const g = gradeHandsTogetherExact(ex, heldMidis, handsMode);
  if (g.wrong.length) { fail(wrongMsg, id + '>x' + midi); if (source !== 'midi') clearHeld(); return; }
  if (g.ok) pass(undefined, ex.short + ': ' + (handsMode === 'right' ? 'right hand' : handsMode === 'left' ? 'left hand' : 'both hands together') + '. ' + fingeringLabel(ex) + '.');
}

// The note-off half of levels 14-17's CHECK phase. Only a real MIDI or
// computer-key release reaches here; ignored outside CHECK.
function stepOff(ctx, ev, out) {
  const { ex, pair, noteState, nname } = ctx, id = ctx.id, midi = ev.midi, source = ev.source;
  if (!pair || pair.phase !== 'check') return;
  const fail = (msg, key) => { out.acts.push({ t: 'fail', msg: msg, key: key }); };
  const pass = (msg) => { out.acts.push({ t: 'pass', q: undefined, msg: msg, assist: undefined, input: source }); };
  const stage = handsStageFromId(id);
  if (stage === 'position') {
    // The one release that matters is the left hand lifting after the shift: it fails and restarts the exercise.
    if (pair.moved && midi === ex.lh.midi && !noteState.isHeld(midi)) { fail('The left hand let go of ' + nname(ex.lh.midi) + ' during the move. Keep it down while your right hand moves up, then start again from the first position.', id + '>l'); pair.moved = false; pair.phase = 'learn'; out.acts.push({ t: 'refresh' }); }
    return;
  }
  if (stage === 'timed') {
    if (!(midi in pair.on)) return;
    pair.off[midi] = ctx.perfNow();
    const g = gradeTimedPair(ex, pair);
    if (g.state === 'pass') { pass(ex.short + ': together, in time.'); return; }
    if (g.state === 'fail') { fail(g.reason, id + '>t'); pair.on = {}; pair.off = {}; }
    return;
  }
  if (stage === 'held') {
    if (midi !== ex.lh.midi || !(midi in pair.on)) return;
    if (noteState.isHeld(midi)) return; // another port is still holding the bass
    pair.off[midi] = ctx.perfNow();
    const g = gradeHeldBass(ex, { bassOn: pair.on[midi], bassOff: pair.off[midi], notes: pair.notes });
    if (g.state === 'pass') { pass(ex.short + ': bass held, melody played over it.'); return; }
    if (g.state === 'fail') { fail(g.reason, id + '>h'); pair.on = {}; pair.off = {}; pair.notes = []; }
    return;
  }
  if (stage === 'split') {
    if (midi === ex.lh.midi) {
      if (!(midi in pair.on)) return;
      if (noteState.isHeld(midi)) return; // another port is still holding it
      pair.off[midi] = ctx.perfNow();
    } else if (midi === ex.rh.midi) {
      if (pair.rhOns.length <= pair.rhOffs.length) return;
      if (noteState.isHeld(midi)) return; // another port is still holding it
      pair.rhOffs.push(ctx.perfNow());
    } else return;
    const g = gradeSplitRhythm(ex, { lhOn: pair.on[ex.lh.midi], lhOff: pair.off[ex.lh.midi], rhOns: pair.rhOns, rhOffs: pair.rhOffs });
    pair.last = { rh: g.rh.state, lh: g.lh.state };
    if (g.state === 'pass') { pass(ex.short + ': two even notes over one held bass.'); return; }
    if (g.state === 'fail') { fail(g.reason, id + '>d'); pair.on = {}; pair.off = {}; pair.rhOns = []; pair.rhOffs = []; }
  }
}
