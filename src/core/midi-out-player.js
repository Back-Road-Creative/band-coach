// "Play it for me": plays one part of a song on a MIDI output the learner picked, and says whether it is
// still playing. Pure of the DOM and of any real clock: the caller hands in the clock and the timers (and,
// in tests, fakes for scheduleSong/playOnOutput), so the stop/end rules can be tested without a browser.
//
// ports: the live MIDIAccess.outputs that are connected; id: the one the learner picked ('' = none, and then
// no Play it for me button is offered -- nothing to play to). busy() is true from the first scheduled note
// until the last one ends (or stop): the MIDI input handler drops input while it is, since a keyboard that
// plays itself also reports those notes back as if the learner pressed them.
export function createMidiOutPlayer({ now, setTimeout, clearTimeout, scheduleSong, playOnOutput }) {
  let ports = [], id = '', busy = false, timer = null, stopSending = null, onEnd = null;
  const selected = () => ports.find(p => p.id === id) || null;
  function stop() {
    clearTimeout(timer); timer = null;
    const stopper = stopSending, done = onEnd; stopSending = null; onEnd = null; busy = false;
    if (stopper) { try { stopper(0); } catch (e) {} }
    if (done) done();
  }
  // The connected outputs changed: a pick that is no longer among them stops playing and is forgotten.
  function setPorts(connected) {
    ports = connected;
    if (id && !selected()) { stop(); id = ''; }
  }
  function select(next) { stop(); id = next || ''; }
  // Schedules one part of `song` on the picked output on the now() timeline (Web MIDI's own
  // timestamp clock), following song.tempoMap. onEnd fires once, on natural end or Stop.
  function play(song, partIndex, onEndCb) {
    const out = selected(); if (!out) return false;
    stop();
    const startMs = now() + 150;
    let msgs; try { msgs = scheduleSong(song, { partIndex: partIndex || 0, startMs, channel: 0 }); } catch (e) { return false; }
    if (!msgs.length) return false;
    stopSending = playOnOutput(out, msgs);
    onEnd = onEndCb || null; busy = true;
    timer = setTimeout(stop, Math.max(0, msgs[msgs.length - 1].atMs - now()) + 250);
    return true;
  }
  return { setPorts, select, selected, selectedId: () => id, play, stop, busy: () => busy, ports: () => ports };
}
