// Where the drawn keyboard and drum kit are, worked out from the DRAWING code
// and nothing else, so an acceptance test can aim a real mouse or finger at them.
// The app has no buttons for these: both instruments are pixels on one canvas
// (#cv), and its hit-test is a second copy of the same arithmetic. A test that
// asked the app where its keys are (the debug hook's kbdKeys()/kitBox()) would
// pass when drawing and hit-test drifted apart together. These formulas are
// written out again here, from src/app.js and src/instruments/how/drum-kit.js
// as of band-coach 4f0f210 (src/** is unchanged since), and checked against what
// the canvas really drew (the test file's helper-versus-canvas check) before any
// click, so a bug in this file shows up as a disagreement with the picture and
// never as a missing hit.
//
// Pure functions: no browser, no import from src/**. Rectangles and points are
// in CANVAS pixels (the app's own units: the canvas's width x height attributes);
// toClient() converts to CSS pixels in the page for the input events. Metrics go
// in, rectangles come out, so a phone-size file can reuse every function.

// What a person's eye sees and an input event needs: observation only, nothing is
// changed in the page. cssWidth/cssHeight is the canvas's box on screen (src/app.js
// size() sets canvas.width = round(cssWidth * min(devicePixelRatio, 2)) every frame).
export async function canvasMetrics(page) {
  return page.evaluate(`(() => {
    const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
    return { left: r.left, top: r.top, cssWidth: r.width, cssHeight: r.height, width: cv.width, height: cv.height,
      devicePixelRatio: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight };
  })()`);
}

// Canvas pixel -> client (CSS) pixel: the inverse of the pointerdown listener's
// `(clientX - r.left) * cv.width / r.width` (src/app.js:2548).
export function toClient(pt, m) {
  return { x: m.left + (pt.x * m.cssWidth) / m.width, y: m.top + (pt.y * m.cssHeight) / m.height };
}

// ---- Keyboard ------------------------------------------------------------
// src/app.js draw(), the two-row layout (:1966-1986; the app always draws C3-C5
// as two rows, kbdRange() :1778): x0 = 0.02W, rowW = 0.96W, labelH = 0.07H,
// gap = 0.02H, rowH = (0.7H - 2 labelH - gap) / 2; y0 = 0.18H, y1 = y0 + labelH,
// y2 = y1 + rowH + gap, y3 = y2 + labelH. Left hand: label at y0, keys 48-59 at y1.
// Right hand: label at y2, keys 60-72 at y3. The overview strip starts at 0.905H,
// 0.07H tall, full row width (:1988).
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const isWhite = (m) => WHITE_PCS.includes(((m % 12) + 12) % 12);

export function keyboardRects(m) {
  const W = m.width, H = m.height;
  const x0 = W * 0.02, rowW = W * 0.96, labelH = H * 0.07, gap = H * 0.02;
  const rowH = (H * 0.7 - 2 * labelH - gap) / 2;
  const y0 = H * 0.18, y1 = y0 + labelH, y2 = y1 + rowH + gap, y3 = y2 + labelH;
  const rows = [
    { row: 0, lo: 48, hi: 59, labelY: y0, keysY: y1 },
    { row: 1, lo: 60, hi: 72, labelY: y2, keysY: y3 },
  ];
  const keys = [];
  const labelStrips = [];
  for (const { row, lo, hi, labelY, keysY } of rows) {
    labelStrips.push({ row, rect: { x: x0, y: labelY, w: rowW, h: labelH } });
    // drawKeys (:1787-1793): kw = rowW / (white keys in the row); white key k is
    // at x0 + k*kw, full kw wide for hit-testing (drawn 1 px inset); a black key
    // sits at (the white key below it) + 0.68 kw, 0.64 kw wide, 0.62 rowH tall.
    let whiteCount = 0;
    for (let n = lo; n <= hi; n++) if (isWhite(n)) whiteCount++;
    const kw = rowW / whiteCount;
    const xs = {};
    let i = 0;
    for (let n = lo; n <= hi; n++) if (isWhite(n)) xs[n] = x0 + kw * i++;
    for (let n = lo; n <= hi; n++) {
      if (isWhite(n)) keys.push({ midi: n, black: false, row, rect: { x: xs[n], y: keysY, w: kw, h: rowH } });
      else keys.push({ midi: n, black: true, row, rect: { x: xs[n - 1] + kw * 0.68, y: keysY, w: kw * 0.64, h: rowH * 0.62 } });
    }
  }
  keys.sort((a, b) => a.midi - b.midi);
  const noHit = [
    ...labelStrips.map((s) => ({ name: s.row === 0 ? 'left-hand label strip' : 'right-hand label strip', rect: s.rect })),
    { name: 'gap between the rows', rect: { x: x0, y: y1 + rowH, w: rowW, h: gap } },
    { name: 'overview strip', rect: { x: W * 0.02, y: H * 0.905, w: W * 0.96, h: H * 0.07 } },
  ];
  return { keys, labelStrips, noHit };
}

// Where to aim at a key. White: the lower body, well clear of any black key. Black:
// its centre, 2 canvas px inside each side edge, and 2 px outside each side edge
// (which must reach the white key beside it: midi - 1 on the left, midi + 1 on the
// right), all at the black key's own mid height.
export function keyboardProbePoints(key) {
  const { x, y, w, h } = key.rect;
  if (!key.black) return [{ label: 'lower body', x: x + w / 2, y: y + 0.8 * h, midi: key.midi }];
  const my = y + h / 2;
  return [
    { label: 'centre', x: x + w / 2, y: my, midi: key.midi },
    { label: 'inside left edge', x: x + 2, y: my, midi: key.midi },
    { label: 'inside right edge', x: x + w - 2, y: my, midi: key.midi },
    { label: 'outside left edge', x: x - 2, y: my, midi: key.midi - 1 },
    { label: 'outside right edge', x: x + w + 2, y: my, midi: key.midi + 1 },
  ];
}

// Where to read a key's colour: two lower-body points on a white key (clear of
// its centred name, the black keys above and the 4 px focus outline), one point in
// the upper part of a black key at 0.2 of its width from the left. Not its centre:
// a black key's centre is the boundary between two white keys, and the focus
// outline (a 4 px #ffd23f frame drawn inside ONE key, src/app.js:1989, on the
// lowest key until an arrow key moves it) runs along that boundary. At least 8
// canvas px from any key edge.
export function keyboardSamplePoints(key) {
  const { x, y, w, h } = key.rect;
  if (!key.black) return [{ x: x + 0.15 * w, y: y + 0.85 * h }, { x: x + 0.85 * w, y: y + 0.85 * h }];
  return [{ x: x + 0.2 * w, y: y + 0.3 * h }];
}

// ---- Drum kit ------------------------------------------------------------
// src/instruments/how/drum-kit.js POSITIONS (:19-30): the unit-square spot and
// radius (fraction of the shorter side) of each piece; spreadX (:60) stretches x.
const KIT_POSITIONS = {
  kick: { x: 0.5, y: 0.78, r: 0.14 },
  snare: { x: 0.33, y: 0.62, r: 0.1 },
  'hihat-closed': { x: 0.13, y: 0.52, r: 0.09 },
  'hihat-pedal': { x: 0.2, y: 0.88, r: 0.06 },
  'hihat-open': { x: 0.13, y: 0.33, r: 0.08 },
  'tom-floor': { x: 0.74, y: 0.62, r: 0.11 },
  'tom-mid': { x: 0.58, y: 0.36, r: 0.08 },
  'tom-high': { x: 0.4, y: 0.38, r: 0.08 },
  crash: { x: 0.22, y: 0.14, r: 0.11 },
  ride: { x: 0.8, y: 0.2, r: 0.12 },
};
const spreadX = (x) => 0.07 + (x - 0.13) * (0.86 / 0.67);

// drawKit (:1892): the kit's box is bw = 0.94W wide, centred; with no kit bar
// running it is bh = 0.9H tall and vertically centred, while a kit bar is on (a
// session with a bar) it is bh = 0.62H tall starting at 0.37H. A piece is a circle
// of radius p.r * min(bw, bh) at (box.x + spreadX(p.x) bw, box.y + p.y bh).
export function kitBox(m, { inBar = false } = {}) {
  const W = m.width, H = m.height, w = W * 0.94, h = inBar ? H * 0.62 : H * 0.9;
  return { x: (W - w) / 2, y: inBar ? H * 0.37 : (H - h) / 2, w, h };
}

export function kitRects(m, { inBar = false } = {}) {
  const box = kitBox(m, { inBar });
  const side = Math.min(box.w, box.h);
  return Object.entries(KIT_POSITIONS).map(([id, p]) => ({ id, cx: box.x + spreadX(p.x) * box.w, cy: box.y + p.y * box.h, r: p.r * side }));
}

const inCircle = (pt, c) => Math.hypot(pt.x - c.cx, pt.y - c.cy) <= c.r;

// Where to aim at a piece: its centre and four compass points 3 canvas px inside
// the edge (all reach the piece), and four 3 px outside it (reach nothing). A point
// that falls inside ANOTHER piece's circle is dropped: where two circles overlap
// the app picks the nearest centre, and this file does not re-implement that.
export function kitProbePoints(piece, all) {
  const others = all.filter((c) => c.id !== piece.id);
  const compass = [['east', 1, 0], ['south', 0, 1], ['west', -1, 0], ['north', 0, -1]];
  const at = (d, dx, dy) => ({ x: piece.cx + dx * d, y: piece.cy + dy * d });
  const pts = [{ label: 'centre', ...at(0, 0, 0), id: piece.id }];
  for (const [name, dx, dy] of compass) pts.push({ label: `inside ${name} edge`, ...at(piece.r - 3, dx, dy), id: piece.id });
  for (const [name, dx, dy] of compass) pts.push({ label: `outside ${name} edge`, ...at(piece.r + 3, dx, dy), id: null });
  return pts.filter((p) => !others.some((o) => inCircle(p, o)));
}

// One point of the kit's box no circle contains: the roomiest spot on a coarse
// grid (greatest distance to the nearest circle's edge), so it is clear of every
// piece and its stroke by a wide margin.
export function kitEmptyPoint(m, opts) {
  const box = kitBox(m, opts), all = kitRects(m, opts);
  let best = null;
  for (let i = 1; i < 20; i++) {
    for (let j = 1; j < 20; j++) {
      const p = { x: box.x + (box.w * i) / 20, y: box.y + (box.h * j) / 20 };
      const room = Math.min(...all.map((c) => Math.hypot(p.x - c.cx, p.y - c.cy) - c.r));
      if (!best || room > best.room) best = { ...p, room };
    }
  }
  return { label: 'empty space', x: best.x, y: best.y, id: null, room: best.room };
}

// Where to read a piece's colour: eight points around it at 0.7 of its radius,
// clear of its 1.5 px stroke.
export function kitSamplePoints(piece) {
  return Array.from({ length: 8 }, (_, k) => ({ x: piece.cx + 0.7 * piece.r * Math.cos((k * Math.PI) / 4), y: piece.cy + 0.7 * piece.r * Math.sin((k * Math.PI) / 4) }));
}

// ---- Phone-size target sizes (CSS px) --------------------------------------
// Everything above is in CANVAS pixels; a person's finger is judged in CSS
// pixels, and the canvas is scaled by its CSS box (m.cssWidth / m.width), never
// by devicePixelRatio (the app caps that at 2, src/app.js size()).
export function cssRect(rect, m) {
  const sx = m.cssWidth / m.width, sy = m.cssHeight / m.height;
  return { x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy };
}

// Every key and kit piece as a target: id, kind, CSS width x height (a kit
// piece's box is its diameter), centre, and the area that answers a tap (a white
// key's area leaves out the black keys over it; a piece's is its circle).
// { kind: 'keyboard' | 'kit', inBar } picks the instrument and the kit's layout.
export function targetSizes(m, { kind = 'keyboard', inBar = false } = {}) {
  if (kind === 'kit') {
    const s = m.cssWidth / m.width;
    return kitRects(m, { inBar }).map((p) => ({ id: p.id, kind: 'piece', w: 2 * p.r * s, h: 2 * p.r * s, cx: p.cx * s, cy: p.cy * (m.cssHeight / m.height), area: { circle: { cx: p.cx * s, cy: p.cy * (m.cssHeight / m.height), r: p.r * s } } }));
  }
  const keys = keyboardRects(m).keys.map((k) => ({ k, r: cssRect(k.rect, m) }));
  return keys.map(({ k, r }) => {
    const base = { id: String(k.midi), kind: k.black ? 'black' : 'white', row: k.row, w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
    if (k.black) return { ...base, area: { rects: [r] } };
    // the white key minus the black keys of its row that sit over it: the part below them, and the strips beside them
    const over = keys.filter((o) => o.k.black && o.k.row === k.row && o.r.x < r.x + r.w && o.r.x + o.r.w > r.x).sort((a, b) => a.r.x - b.r.x);
    if (!over.length) return { ...base, area: { rects: [r] } };
    const bh = Math.max(...over.map((o) => o.r.h)), rects = [{ x: r.x, y: r.y + bh, w: r.w, h: r.h - bh }];
    let x = r.x;
    for (const o of over) { if (o.r.x > x) rects.push({ x, y: r.y, w: o.r.x - x, h: bh }); x = Math.max(x, o.r.x + o.r.w); }
    if (x < r.x + r.w) rects.push({ x, y: r.y, w: r.x + r.w - x, h: bh });
    return { ...base, area: { rects } };
  });
}

const dist = (px, py, a) => (a.circle ? Math.max(0, Math.hypot(px - a.circle.cx, py - a.circle.cy) - a.circle.r) : Math.min(...a.rects.map((q) => Math.hypot(Math.max(q.x - px, 0, px - q.x - q.w), Math.max(q.y - py, 0, py - q.y - q.h)))));

// The 24 CSS px target rule, axe-core's own (target-size, minSize 24 and
// target-offset, minOffset 24): a target passes if its box is at least 24 x 24;
// otherwise its centre must be at least 12 from every other target's tap area
// and at least 24 from the centre of every other target that is under 24 too.
// Returns { ok, floor, why }; floor is the plain 24 x 24 test.
export function spacingOk(target, neighbours) {
  const floor = target.w >= 24 && target.h >= 24;
  if (floor) return { ok: true, floor, why: '' };
  const others = neighbours.filter((n) => n.id !== target.id || n.kind !== target.kind);
  const near = others.map((n) => ({ n, d: dist(target.cx, target.cy, n.area) })).sort((a, b) => a.d - b.d)[0];
  if (near && near.d < 12) return { ok: false, floor, why: `under 24 px and its centre is ${near.d.toFixed(1)} px from ${near.n.id}'s tap area (12 needed)` };
  const small = others.filter((n) => n.w < 24 || n.h < 24).map((n) => ({ n, d: Math.hypot(target.cx - n.cx, target.cy - n.cy) })).sort((a, b) => a.d - b.d)[0];
  if (small && small.d < 24) return { ok: false, floor, why: `under 24 px and its centre is ${small.d.toFixed(1)} px from the centre of ${small.n.id}, also under 24 (24 needed)` };
  return { ok: true, floor, why: '' };
}
