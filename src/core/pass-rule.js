// Pure pass/fail rule for one judged song-practice step: whether a
// judgeAttempt() result (src/ui/songs/practice.js) satisfies a passRule, and
// which rule failed first. No DOM, no AudioContext, no clock.

// Shared with src/ui/songs/practice.js's judgeAttempt opts.durationTolerance default and
// holdTuneFeedback()'s per-hit direction check -- one number, not two, so a
// hit that reads "outside the band" in the score always means the same
// thing it means in the feedback text.
export const DEFAULT_DURATION_TOLERANCE = { min: 0.6, max: 1.5 };

// Whether a judgeAttempt() result satisfies a step's passRule. A null
// passRule (the "listen" step kind) always passes — there is nothing to
// judge, the learner just heard the phrase.
export function passesRule(result, passRule) {
  if (!passRule) return true;
  if (result.hitRate < passRule.hitRate) return false;
  if (passRule.maxMeanErrorMs != null) {
    if (result.meanErrorMs == null) { if (result.judgedCount !== 0) return false; }
    else if (result.meanErrorMs > passRule.maxMeanErrorMs) return false;
  }
  if (passRule.maxMeanAbsCents != null && result.meanAbsCents != null) {
    if (result.meanAbsCents > passRule.maxMeanAbsCents) return false;
  }
  if (passRule.minDurationScore != null && result.durationScore != null) {
    if (result.durationScore < passRule.minDurationScore) return false;
  }
  // minPieceRate (a percussion step, P4-11) is ignored whenever pieceRate is
  // null -- nothing the mic could name, so there is nothing to hold the
  // learner to; the step can still pass on hitRate/timing alone.
  if (passRule.minPieceRate != null && result.pieceRate != null) {
    if (result.pieceRate < passRule.minPieceRate) return false;
  }
  // A wrong note struck alongside a chord (src/ui/songs/practice.js judgeAttempt's extras)
  // never lowers hitRate -- that is deliberate chord-spread leniency, not a
  // pass on its own -- so a step whose passRule sets maxExtras still has to
  // gate on it separately here.
  if (passRule.maxExtras != null && result.extras && result.extras.count > passRule.maxExtras) return false;
  return true;
}

// Plain-word feedback for a FAILED step that fell down ONLY on hold or tune
// -- everything else about it (hit rate, timing) was fine, so telling the
// learner the one concrete thing to fix beats the generic "try that again"

// Which rule passesRule found wrong FIRST -- same check order it
// runs in -- shared by src/ui/songs/practice.js's firstCorrection (the plain-word message) and
// src/core/teaching.js's repairFor (which notes to isolate into a repair
// step). Returns { dim, noteIndices }: dim is null when the try actually
// passed or nothing enumerated here explains the failure (a hand-built
// result whose hitRate disagrees with its matches, say); noteIndices index
// into result.matches, which judgeAttempt always builds in the same
// order as the step's own `notes` array, so a caller can map straight back
// to the notes that need isolating.
export function failedDimension(result, passRule) {
  if (!passRule || passesRule(result, passRule)) return { dim: null, noteIndices: [] };
  if (result.hitRate < passRule.hitRate) {
    const indices = (result.matches || []).reduce((acc, m, i) => { if (!m.ok) acc.push(i); return acc; }, []);
    if (indices.length) return { dim: 'pitch', noteIndices: indices };
  }
  if (passRule.maxMeanErrorMs != null) {
    const timingFailed = result.meanErrorMs == null
      ? result.judgedCount !== 0
      : result.meanErrorMs > passRule.maxMeanErrorMs;
    if (timingFailed) {
      const timed = (result.matches || [])
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.ok && m.errorMs != null);
      if (timed.length) {
        let indices = timed.filter(({ m }) => Math.abs(m.errorMs) > passRule.maxMeanErrorMs).map(({ i }) => i);
        // No single hit individually clears the threshold (the MEAN did, so
        // several smaller errors added up) -- fall back to the single worst
        // one, same note firstCorrection's own late/early line already names.
        if (!indices.length) {
          const worst = timed.reduce((a, b) => (Math.abs(b.m.errorMs) > Math.abs(a.m.errorMs) ? b : a));
          indices = [worst.i];
        }
        return { dim: 'onset', noteIndices: indices };
      }
    }
  }
  const holdFailed = passRule.minDurationScore != null && result.durationScore != null
    && result.durationScore < passRule.minDurationScore;
  const tuneFailed = passRule.maxMeanAbsCents != null && result.meanAbsCents != null
    && result.meanAbsCents > passRule.maxMeanAbsCents;
  // passesRule checks maxMeanAbsCents (tune) before minDurationScore (hold),
  // so tune is the "first" of the two when both are actually wrong.
  if (tuneFailed) {
    const indices = (result.matches || [])
      .reduce((acc, m, i) => { if (m.ok && m.cents != null && Math.abs(m.cents) > passRule.maxMeanAbsCents) acc.push(i); return acc; }, []);
    if (indices.length) return { dim: 'tune', noteIndices: indices };
  }
  if (holdFailed) {
    const indices = (result.matches || [])
      .reduce((acc, m, i) => {
        if (m.ok && m.durRatio != null
          && (m.durRatio < DEFAULT_DURATION_TOLERANCE.min || m.durRatio > DEFAULT_DURATION_TOLERANCE.max)) acc.push(i);
        return acc;
      }, []);
    if (indices.length) return { dim: 'hold', noteIndices: indices };
  }
  // minPieceRate (P4-11): checked in the same order as passesRule, right
  // after tune/hold and before extras -- a wrong-drum hit is worth naming
  // even though the onset itself landed on time.
  if (passRule.minPieceRate != null && result.pieceRate != null && result.pieceRate < passRule.minPieceRate) {
    const indices = (result.matches || []).reduce((acc, m, i) => { if (m.pieceOk === false) acc.push(i); return acc; }, []);
    if (indices.length) return { dim: 'piece', noteIndices: indices };
  }
  if (passRule.maxExtras != null && result.extras && result.extras.count > passRule.maxExtras) {
    // An extra note isn't one of the expected notes -- nothing in `notes` to
    // isolate a repair around, so this is deliberately empty.
    return { dim: 'extras', noteIndices: [] };
  }
  return { dim: null, noteIndices: [] };
}
