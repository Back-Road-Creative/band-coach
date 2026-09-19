// Pure text mirror of what an exercise canvas is showing right now, for the
// visually-hidden element that `aria-describedby` points at (unit 7.7 item 1).
//
// Recall-first: the target identity of a "find it" task is not spoken until
// the caller says the task is revealed (its own e.reveal || e.failed flag —
// the same one the canvas dot/highlight is gated on), so the text mirror
// never tells a screen-reader user more than a sighted learner can see.

const LETTERS = 'CDEFGAB';
const LINE_ORDINALS = ['bottom', 'second', 'middle', 'fourth', 'top'];
const SPACE_ORDINALS = ['bottom', 'second', 'third', 'top'];

function staffPosition(label, clef) {
  const m = /^([A-G])[^\d-]*(-?\d+)$/.exec(label);
  if (!m) return 'on the staff';
  const letter = LETTERS.indexOf(m[1]);
  const oct = parseInt(m[2], 10);
  const step = oct * 7 + letter;
  const bottomStep = clef === 'bass' ? 18 : 30;
  const diff = step - bottomStep;
  if (diff < 0) return Math.round(-diff / 2) + ' ledger line' + (-diff > 2 ? 's' : '') + ' below the staff';
  if (diff > 8) return Math.round((diff - 8) / 2) + ' ledger line' + (diff - 8 > 2 ? 's' : '') + ' above the staff';
  if (diff % 2 === 0) return (LINE_ORDINALS[diff / 2] || diff / 2) + ' line';
  return (SPACE_ORDINALS[(diff - 1) / 2] || (diff - 1) / 2) + ' space';
}

function describeNote(info, revealed) {
  if (info.clef) {
    const staff = info.clef === 'bass' ? 'Bass staff' : 'Treble staff';
    const pos = staffPosition(info.label, info.clef);
    return revealed ? `${staff}. Play this note: ${info.label} — ${pos}.` : `${staff}. Find and play this note: ${pos}.`;
  }
  if (info.string !== undefined) {
    if (!revealed) return 'Fretboard. Find and play this note.';
    const where = info.fret ? `string ${info.string}, fret ${info.fret}` : `string ${info.string}, open`;
    return `Fretboard. Play this note: ${info.label.split(':')[0]} — ${where}.`;
  }
  if (info.anywhere) {
    return revealed ? `Play this note by name: ${info.short}.` : 'Find and play this note by name, anywhere on the instrument.';
  }
  if (info.degree !== undefined) {
    // handled by the caller (needs task.ref), see describeTask
    return revealed ? `Sing this note: ${info.short}.` : 'Find this note by ear.';
  }
  return revealed ? `Piano keyboard. Play this note: ${info.label}.` : 'Piano keyboard. Find and play this note.';
}

/**
 * @param {object|null} task the current exercise task, as built by
 *   buildLevelTask()/buildTask() in src/app.js
 * @param {{revealed?: boolean}} opts revealed must mirror the current
 *   element's own `e.reveal || e.failed` flag — never invent it here
 * @returns {string} one plain sentence describing what the canvas shows
 */
export function describeTask(task, opts = {}) {
  if (!task || !task.els || !task.els.length) return 'Pick an instrument, then press Start.';
  const revealed = !!opts.revealed;

  if (task.kind === 'bar') {
    const cells = task.els.map((e) => e.info.short || e.info.label).join(', ');
    return `Rhythm: ${cells}. Tap along after the count-in.`;
  }

  if (task.kind === 'ear') {
    const e = task.els[0];
    const n = (task.choices || []).length;
    const noun = e.info.kind === 'quality' ? 'chord' : 'interval';
    if (!revealed) return `Ear training: listen, then choose the ${noun} you heard from ${n} option${n === 1 ? '' : 's'}.`;
    return `That was a ${e.info.label}.`;
  }

  const idx = Math.min(task.idx || 0, task.els.length - 1);
  const e = task.els[idx];
  const info = e.info;

  let sentence;
  if (info.kind === 'chord') {
    sentence = `Play the chord: ${info.label}.`;
  } else if (info.kind === 'interval') {
    sentence = revealed ? `Play the interval: ${info.label}.` : 'Listen, then play the interval you hear.';
  } else if (info.degree !== undefined) {
    if (revealed) sentence = `Sing this note: ${info.short}.`;
    else sentence = task.ref === 'target' ? 'Sing back the note you just heard, in any octave.' : 'Find this note by ear, counting up from Do.';
  } else {
    sentence = describeNote(info, revealed);
  }

  if (task.kind === 'hold') sentence += ' Hold it for two seconds.';
  if (task.kind === 'seq' && task.els.length > 1) sentence = `Move ${idx + 1} of ${task.els.length}. ${sentence}`;

  return sentence;
}
