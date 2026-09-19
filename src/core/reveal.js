// Pure recall/reveal decision logic shared by every instrument mode.
// No DOM, no globals, no state — the caller supplies everything it needs.
//
// The app's existing rule (src/app.js buildLevelTask()'s mk(), and failEl()):
// an item's answer is exposed for its first two exposures, after a miss on
// the current task, or when the learner explicitly asks ("Show me"). Every
// other exposure is a pure recall test — no answer shown. This module gives
// that rule one home so every render/text call site enforces it the same way.

export function shouldReveal({ exposures = 0, failedThisTask = false, revealRequested = false, isNew = false } = {}) {
  if (revealRequested) return true;
  if (failedThisTask) return true;
  const seen = isNew ? 0 : exposures;
  return seen < 2;
}

// promptFor/hintFor take the item's `info` record (as built by app.js's
// info()/inf()) plus whether it is currently revealed, and return the text
// to show. The unrevealed form asks for what the learner must produce (the
// note); the revealed form gives the full positional answer. For kinds with
// no positional secret (the prompt already names the note, e.g. fretted
// instruments) the prompt text does not change with reveal state — only the
// hint and the visual dot do, at their own call sites.

export function promptFor(item, revealed) {
  if (!item) return '';
  const isHarmonica = item.hole !== undefined && item.dir !== undefined;
  if (isHarmonica) {
    if (revealed) return (item.dir === 'b' ? 'Blow ' : 'Draw ') + item.hole;
    return item.note || item.short || '';
  }
  if (item.label !== undefined) return item.label.split(':')[0];
  return item.short || '';
}

export function hintFor(item, revealed) {
  if (!item) return '';
  const mic = ' The mic checks the note and its octave — not which string you used.';
  if (item.string !== undefined) {
    if (!revealed) return 'Find this note on the neck.' + mic;
    return 'String ' + item.string + (item.fret ? ', fret ' + item.fret : ', played open') + '. The dot shows where.' + mic;
  }
  const isHarmonica = item.hole !== undefined && item.dir !== undefined;
  if (isHarmonica) {
    if (!revealed) return 'Find this note on the harmonica.';
    return (item.dir === 'b' ? 'Blow ' : 'Draw ') + ' hole ' + item.hole + '. It is lit up now.';
  }
  return '';
}
