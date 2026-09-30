// Pure helper (no DOM, no audio): groups notes that share a `start` tick into
// chords, each entry keeping the note's index in the input. Shared by
// fretted.js and keys.js.

export function groupByStart(notes) {
  const byStart = new Map();
  notes.forEach((note, index) => {
    const list = byStart.get(note.start) || [];
    list.push({ note, index });
    byStart.set(note.start, list);
  });
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, entries]) => ({ start, entries }));
}
