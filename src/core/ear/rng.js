// Deterministic PRNG for the ear-training generators. No Math.random and no
// Date.now anywhere in this tree: every generator takes (level, seed) and
// must return the exact same question for the same inputs, forever, because
// tests pin exact values and a learner's "show me that one again" depends on
// it.
//
// mulberry32 (public-domain small PRNG): fast, decent distribution for
// picking from short lists. Seeded by folding level and seed into one
// 32-bit integer so (level, seed) pairs never collide for the ranges this
// app uses (level 1-99, seed 0-1e9).

export function seedFrom(level, seed) {
  let h = (Number(level) >>> 0) * 0x9e3779b1;
  h = (h ^ (Number(seed) >>> 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h || 1; // mulberry32 stays zero forever if seeded with 0
}

export function makeRng(level, seed) {
  let a = seedFrom(level, seed);
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer in [lo, hi) - lo inclusive, hi exclusive.
export function intRange(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo));
}

export function pickFrom(rng, list) {
  return list[intRange(rng, 0, list.length)];
}
