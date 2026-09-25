// Streaming onset + classify loop for a Songs drum step's microphone path
// (P4-12). This is src/app.js's listenDrums() (app.js:1528-1573) turned into
// a pure, DOM/AudioContext-free function: same DRUM_FRAME/DRUM_HOP, the same
// onset-detector overrides (~100 ms of flux history instead of ~1 s, a
// 0.0005 RMS minFlux floor), the same REL_JUMP-style energy guard, the same
// "hold classification until (DRUM_FRAME - preroll) worth of audio has
// arrived after the attack" timing (see app.js's own comment for why: a
// synthesized kick classified with no wait came back kind: null half the
// time), and the same kind->piece map -- copied rather than imported since
// app.js's own copy is wired to its AudioContext/analyser and is not this
// unit's to change.
//
// createDrumCapture({sampleRate}).push(chunk, nowSec) -> [{atSec, piece,
// confidence}]: chunk is one new hop of raw PCM (DRUM_HOP samples is what
// the tuning above assumes -- src/ui/songs.js's mic loop feeds exactly
// that, the same way it already splits the analyser's newest audio into
// hops for the pitch path), nowSec the audio-clock time at chunk's end.
// Usually returns []: classification is deliberately held back a little, so
// a hit is returned from a LATER push() than the one that heard its attack.
// piece is null when an onset was heard but the classifier could not name
// it (a tom, crash or ride -- see src/audio/drum-classify.js).
import { createOnsetDetector } from '../../audio/onset.js';
import { createDrumClassifier } from '../../audio/drum-classify.js';

const DRUM_KIND_TO_PIECE = { kick: 'kick', snare: 'snare', hihat: 'hihat-closed' };

export function createDrumCapture({ sampleRate } = {}) {
  if (!(sampleRate > 0)) throw new Error('createDrumCapture requires a sampleRate');
  const DRUM_FRAME = 2048, DRUM_HOP = 512;
  const DRUM_PREROLL = DRUM_FRAME >> 3;
  const wait = (DRUM_FRAME - DRUM_PREROLL) / sampleRate;
  const onsetDetector = createOnsetDetector({ sampleRate, frameSize: DRUM_HOP, hop: DRUM_HOP, historyFrames: Math.max(4, Math.round(0.1 * sampleRate / DRUM_HOP)), minFlux: 0.0005 });
  const classifier = createDrumClassifier({ sampleRate, frameSize: DRUM_FRAME });
  let buf = new Float32Array(0); // every raw sample pushed so far, oldest first
  let pending = []; // onsets heard but not yet classified: { attackT, dueT }

  return {
    push(chunk, nowSec) {
      const merged = new Float32Array(buf.length + chunk.length);
      merged.set(buf, 0); merged.set(chunk, buf.length);
      buf = merged;
      const o = onsetDetector.push(chunk);
      if (o.onset) {
        // classifyHits()'s REL_JUMP guard, repeated here for the same reason
        // app.js's listenDrums() repeats it: the tiny minFlux floor above
        // (needed to keep hearing a quiet real kit) also lets a steady tone
        // or hum wobble over threshold; requiring the flux spike to be a
        // real jump relative to the samples around it is what rejects that.
        const fs = buf.subarray(Math.max(0, buf.length - DRUM_FRAME));
        let frameE = 0; for (let i = 0; i < fs.length; i++) frameE += fs[i] * fs[i];
        if (o.strength >= 0.1 * Math.sqrt(frameE / DRUM_FRAME)) pending.push({ attackT: nowSec, dueT: nowSec + wait });
      }
      const hits = [];
      pending = pending.filter((p) => {
        if (nowSec < p.dueT) return true;
        const offset = Math.max(0, Math.round((nowSec - p.dueT) * sampleRate));
        const from = Math.max(0, buf.length - offset - DRUM_FRAME);
        const r = classifier.classify(buf.subarray(from, Math.min(buf.length, from + DRUM_FRAME)));
        hits.push({ atSec: p.attackT, piece: r.kind ? (DRUM_KIND_TO_PIECE[r.kind] || null) : null, confidence: r.confidence });
        return false;
      });
      return hits;
    },
  };
}
