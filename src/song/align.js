// Pure note-level alignment (F3): line up a free-tempo take against a
// reference note sequence (a song, or a fitted step of one) with note-level
// dynamic time warping / edit-distance, not frame-by-frame audio matching.
// A learner never plays exactly on the song's own clock — this tolerates a
// take that is globally slower/faster and one that drifts mid-take (a
// ritardando) by comparing each note's position *normalised to its own
// take's span* rather than absolute seconds. No DOM, no AudioContext, no
// clock reads: the caller (a later unit, not this one) supplies whatever
// timestamps it measured and owns the clock; this module only does the
// matching arithmetic. Nothing here is wired into practice.js yet.

// The span a note list covers, first note's start to last note's end, used
// to normalise every note's position into 0..1 so tempo scale drops out of
// the time-distance term. A single note (or empty list) gets a span of 1 so
// division never blows up.
function span(notes) {
  if (!notes.length) return 1;
  const first = notes[0].start;
  const last = notes[notes.length - 1].start + (notes[notes.length - 1].dur || 0);
  return Math.max(last - first, 1e-6);
}

// A note's position within its own list, 0 at the first onset, growing
// toward (not necessarily reaching) 1 at the last. Comparing these between
// ref and take is what makes the match tempo-drift tolerant: a uniformly
// slower take, or one that gradually rushes/drags, still has onsets landing
// at roughly the same normalised position note-for-note.
function normPos(notes, i, total, first) {
  return (notes[i].start - first) / total;
}

// Sakoe-Chiba band: for a long take, only cells within `band` notes of the
// diagonal from (0,0) to (refLen, takeLen) are considered, so cost is
// O(n*band) instead of O(n*m). The diagonal is scaled to the two lengths
// (not a raw i==j band) so a ref and take of slightly different note counts
// still get a sensible corridor. band == null means "no band" (small takes,
// or correctness-critical callers): compute the full matrix.
function bandRange(i, refLen, takeLen, band) {
  if (band == null) return [0, takeLen];
  const center = refLen ? Math.round((i * takeLen) / refLen) : 0;
  return [Math.max(0, center - band), Math.min(takeLen, center + band)];
}

// ref, take: [{ midi, start, dur }], start/dur in the caller's chosen time
// unit (seconds once converted from song ticks) — align.js only compares
// ref's unit against take's own unit, never mixes them with a wall clock.
// opts.band: Sakoe-Chiba half-width in notes (see bandRange), default
// unrestricted. opts.pitchCost: cost of pairing two notes of different
// pitch (paired anyway if still cheaper than skipping both — a wrong note,
// not a missed one). opts.insCost/delCost: cost of an unmatched take note
// ("extra") / unmatched ref note ("missed"). opts.timeWeight: how much a
// normalised-position mismatch tips the choice between candidate pairings
// when pitch alone doesn't decide it.
// Returns { pairs, missed, extra, warp, cost }: pairs is every (refIndex,
// takeIndex) matched, in ref order; missed is ref indices with no take
// note; extra is take indices with no ref note; warp is the (refTime,
// takeTime) of every pair, in ref order, for later tempo-curve display;
// cost is the total edit distance of the chosen alignment.
export function alignNotes(ref, take, opts = {}) {
  const { band = null, pitchCost = 1, insCost = 1.6, delCost = 1.6, timeWeight = 0.5 } = opts;
  const refN = ref || [];
  const takeN = take || [];
  const n = refN.length;
  const m = takeN.length;
  const refFirst = n ? refN[0].start : 0;
  const takeFirst = m ? takeN[0].start : 0;
  const refSpan = span(refN);
  const takeSpan = span(takeN);

  // D[i][j]: min cost aligning ref[0..i) with take[0..j). move[i][j]: which
  // choice got there — 0 = diagonal (pair/substitute), 1 = up (ref note
  // missed), 2 = left (take note extra).
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const move = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    D[i][0] = i * delCost;
    move[i][0] = 1;
  }
  for (let j = 1; j <= m; j++) {
    D[0][j] = j * insCost;
    move[0][j] = 2;
  }

  for (let i = 1; i <= n; i++) {
    const [lo, hi] = bandRange(i, n, m, band);
    const jLo = Math.max(1, lo);
    const jHi = Math.min(m, hi);
    const rp = normPos(refN, i - 1, refSpan, refFirst);
    for (let j = jLo; j <= jHi; j++) {
      const tp = normPos(takeN, j - 1, takeSpan, takeFirst);
      const pCost = refN[i - 1].midi === takeN[j - 1].midi ? 0 : pitchCost;
      const tCost = timeWeight * Math.abs(rp - tp);
      const sub = D[i - 1][j - 1] + pCost + tCost;
      const del = D[i - 1][j] + delCost;
      const ins = D[i][j - 1] + insCost;
      let best = sub;
      let bm = 0;
      if (del < best) {
        best = del;
        bm = 1;
      }
      if (ins < best) {
        best = ins;
        bm = 2;
      }
      D[i][j] = best;
      move[i][j] = bm;
    }
  }

  const pairs = [];
  const missed = [];
  const extra = [];
  const warp = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && move[i][j] === 0) {
      pairs.push({ refIndex: i - 1, takeIndex: j - 1 });
      warp.push({ refTime: refN[i - 1].start, takeTime: takeN[j - 1].start });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || move[i][j] === 1)) {
      missed.push(i - 1);
      i--;
    } else {
      extra.push(j - 1);
      j--;
    }
  }
  pairs.reverse();
  missed.reverse();
  extra.reverse();
  warp.reverse();
  return { pairs, missed, extra, warp, cost: D[n][m] };
}
