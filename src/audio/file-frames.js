// Turns a decoded audio file (mono PCM samples + its real sample rate) into
// the exact `frames`/`onsets` input src/song/transcribe.js's `transcribe`
// already accepts, so a later PR can wire "load an audio file -> notes" into
// the editor without teaching transcribe.js anything new about where its
// input came from.
//
// Pure on purpose, like src/ui/editor/record.js's sampleFrame and
// src/ui/playalong/audio-prep.js's mixToMono: a Float32Array and a number in,
// plain frame objects out -- no DOM, no AudioContext, no clock. The caller
// (a future file-import panel) owns decoding the file and mixing it to mono
// (mixToMono already does that step); this module only walks the resulting
// samples.
//
// Monophonic only, the same honest limit as the rest of this app's pitch
// tracking (src/audio/yin.js can only ever report one fundamental per
// window): a chord or a second voice will read as whichever pitch YIN locks
// onto, not as multiple notes. basic-pitch (~2.2 MB) was measured against
// this app's 640 KB total size budget (tests/build/voice-size-budget.test.mjs)
// and does not fit, so this is deliberately hand-rolled on top of code
// already shipping in the app.
//
// The analysis cadence mirrors createRecorder's live mic loop (record.js):
// a window read every hopMs (default 50ms, matching the app's own tool-pitch
// polling interval) so a file transcription behaves the same as a mic
// transcription of the same performance. windowSize (default 4096, an
// analyser-sized buffer) matches record.js's default fftSize; unlike a live
// analyser, sliding windows here overlap on purpose since a 50ms hop is
// shorter than a 4096-sample window at any sample rate this app supports.
import { yin } from './yin.js';
import { createOnsetDetector } from './onset.js';
import { FALLBACK_RANGE } from './range.js';

// pcm: a Float32Array of mono samples (already mixed down, e.g. via
// src/ui/playalong/audio-prep.js's mixToMono -- this module accepts either a
// pre-mixed mono buffer or, just as validly, a single already-mono channel).
// sampleRate: the file's real decoded rate (44.1kHz, 48kHz and anything else
// a browser's decodeAudioData hands back are all fine; nothing here is
// hardcoded to one rate). fmin/fmax default to the app's generic search band
// (src/audio/range.js's FALLBACK_RANGE) the same way record.js's
// createRecorder falls back when no instrument is known.
export function framesFromPCM(pcm, sampleRate, { fmin, fmax, gate, hopMs = 50, windowSize = 4096 } = {}) {
  const activeFmin = typeof fmin === 'number' ? fmin : FALLBACK_RANGE.fmin;
  const activeFmax = typeof fmax === 'number' ? fmax : FALLBACK_RANGE.fmax;
  const hopSamples = Math.max(1, Math.round((hopMs / 1000) * sampleRate));
  const total = pcm ? pcm.length : 0;
  const frames = [];
  const onsets = [];
  if (!total) return { frames, onsets };

  // historyFrames small on purpose: onset.js's own default (43) assumes a
  // long-running live stream where a baseline has time to settle across many
  // notes. A file is short and every note attack matters from the first one,
  // so the adaptive baseline here only looks back ~6 hops (well under a
  // second at the default 50ms hop) -- long enough to smooth out a single
  // frame's noise, short enough that one loud attack near the start of a
  // clip does not go on suppressing the detector for the notes after it.
  const onsetDetector = createOnsetDetector({ sampleRate, frameSize: windowSize, hop: hopSamples, historyFrames: 6 });
  // Walk the clip in hop-sized steps. Pitch tracking reads a full windowSize
  // buffer at each step (zero-padded past the end of the clip -- this is
  // what lets a clip shorter than one window still produce a single frame
  // attempt instead of nothing at all), matching record.js's analyser-sized
  // window. Onset detection instead gets just the new hop's worth of samples
  // (onset.js's push() explicitly accepts "the newest hop's worth" as well
  // as a full window) -- a windowSize buffer overlaps ~46 hops out of every
  // 92ms at these defaults, which smears a sharp attack's energy flux across
  // several steps and buries the next attack under an already-elevated
  // baseline; a plain hop-sized slice reports the clip's real moment-to-
  // moment energy change undiluted. The loop always processes the final
  // partial window/hop once, then stops, rather than overrunning the clip.
  for (let start = 0; ; start += hopSamples) {
    const buf = new Float32Array(windowSize);
    const end = Math.min(start + windowSize, total);
    buf.set(pcm.subarray(start, end));
    const t = start / sampleRate;

    const hopEnd = Math.min(start + hopSamples, total);
    const o = onsetDetector.push(pcm.subarray(start, hopEnd));
    if (o.onset) onsets.push(t);

    const r = yin(buf, sampleRate, activeFmin, activeFmax, gate);
    if (r.freq) {
      // Rounded to a millisemitone (1/1000 of a semitone, ~0.1 cent): a
      // steady tone's true pitch does not change window to window, but
      // yin()'s own parabolic interpolation (src/audio/yin.js) returns a
      // slightly different float each time depending on exactly which
      // samples fall in a shifted analysis window. transcribe.js's
      // eventsToNotes groups consecutive same-pitch frames into one note by
      // exact equality of `midi` (see its header contract), so leaving that
      // sub-thousandth noise in would silently fragment every real note into
      // a run of single frames, each one shorter than minNoteMs and thrown
      // away. A millisemitone is far below the ±0.5-semitone accuracy this
      // module is judged on, so nothing meaningful is lost.
      const midi = Math.round((69 + 12 * Math.log2(r.freq / 440)) * 1000) / 1000;
      const confidence = typeof r.clarity === 'number' ? Math.max(0, Math.min(1, r.clarity)) : 1;
      frames.push({ t, midi, rms: r.rms, confidence });
    }

    if (end >= total) break;
  }

  return { frames, onsets };
}
