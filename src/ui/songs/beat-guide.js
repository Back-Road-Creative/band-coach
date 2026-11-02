// The strip above a song's notes during a try: the beat number, and a runway of
// the notes sliding toward a "now" line, each reaching it the moment to play it.
// Timing comes from src/core/beat-cues.js; songs.js decides what a step may show
// (guideSpec: Check gets the count-in and nothing to follow).
//
// One canvas lives through the whole try. renderPractice() rebuilds the panel's
// DOM, so it calls attach() again rather than this module owning a place on the
// page. It carries its state as data-* attributes for tests: phase (count, play,
// done), beat, index, runway (on, off), motion (slide, step), blocks, clicks.
import { t } from '../../core/i18n.js';
import { beatAt, cueClock, runwayBlocks } from '../../core/beat-cues.js';

const WIDTH = 640, LOOKAHEAD_SEC = 0.12;
const pieceNames = () => ({
  kick: t('kit.piece.kick'), snare: t('kit.piece.snare'), 'hihat-closed': t('kit.piece.hihat-closed'),
  'hihat-open': t('kit.piece.hihat-open'), 'hihat-pedal': t('kit.piece.hihat-pedal'), 'tom-high': t('kit.piece.tom-high'),
  'tom-mid': t('kit.piece.tom-mid'), 'tom-floor': t('kit.piece.tom-floor'), crash: t('kit.piece.crash'), ride: t('kit.piece.ride'),
});

export function createBeatGuide({ countTimes, originSec, spec, now, latencyMs, click, clicksOn }) {
  // Sizes are for a 640-wide canvas; a phone shows it at about half that, so
  // the text and the rows are drawn big enough to survive it.
  const rows = spec.rows.length, height = Math.max(120, rows * 30);
  const named = rows > 0 && spec.rows[0] !== null, lanesX = named ? 180 : 80, nowX = lanesX + 40;
  const canvas = document.createElement('canvas');
  canvas.className = 'panel-songs-beat-guide';
  canvas.width = WIDTH; canvas.height = height;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('songs.beatGuide.label'));
  const steps = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  canvas.dataset.runway = spec.runway ? 'on' : 'off';
  canvas.dataset.motion = steps ? 'step' : 'slide';
  canvas.dataset.clicks = '0';
  const ctx = canvas.getContext('2d'), names = pieceNames();
  const playTimes = spec.phraseBeats.map((s) => originSec + s);
  const beatSec = spec.phraseBeats.length > 1 ? spec.phraseBeats[1] - spec.phraseBeats[0] : 0.75;
  let frameId = null, stopped = false, next = 0, sounded = 0;

  // Clicks are booked a little ahead on the real audio clock, like the trainer's.
  function bookClicks(audioNow) {
    if (!clicksOn) return;
    while (next < playTimes.length && playTimes[next] < audioNow + LOOKAHEAD_SEC) {
      if (playTimes[next] > audioNow - 0.01) { click(playTimes[next], next % spec.perBar === 0); sounded++; }
      next++;
    }
  }

  function drawNumber(beat) {
    if (!beat) return;
    ctx.fillStyle = beat.n === 1 ? '#f3c52f' : '#e9edf6';
    ctx.font = `700 ${Math.round(64 * (steps ? 1 : 1 + 0.18 * beat.pulse))}px "Barlow Condensed", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(beat.n), 36, height / 2);
  }

  function drawRunway(at) {
    const laneH = height / rows, blocks = runwayBlocks(spec.notes, at - originSec, { windowSec: 4 * beatSec, nowX, width: WIDTH });
    if (named) {
      ctx.fillStyle = '#c4d0e6'; ctx.font = '600 22px "Barlow Condensed", Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      spec.rows.forEach((piece, i) => ctx.fillText(names[piece] || piece, lanesX - 6, laneH * (i + 0.5), lanesX - 80));
    }
    ctx.save(); ctx.beginPath(); ctx.rect(lanesX, 0, WIDTH - lanesX, height); ctx.clip();
    blocks.forEach((b) => {
      const w = Math.max(6, b.w), due = b.x <= nowX && b.x + w >= nowX;
      ctx.fillStyle = due ? '#f3c52f' : b.x + w < nowX ? '#3a4256' : '#e9edf6';
      ctx.fillRect(b.x, b.row * laneH + 3, w, laneH - 6);
    });
    ctx.restore();
    ctx.strokeStyle = '#f3c52f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(nowX, 0); ctx.lineTo(nowX, height); ctx.stroke();
    return blocks.length;
  }

  function draw() {
    const audioNow = now(), at = cueClock(audioNow, latencyMs, 0);
    bookClicks(audioNow);
    const counting = at < originSec, times = counting ? countTimes : playTimes;
    const beat = beatAt(at, times, counting ? countTimes.length : spec.perBar);
    const phase = counting ? 'count' : beat ? 'play' : 'done';
    ctx.fillStyle = '#10141f'; ctx.fillRect(0, 0, WIDTH, height);
    drawNumber(beat);
    const blocks = spec.runway ? drawRunway(steps && beat ? times[beat.index] : at) : 0;
    // Nothing is left to show once a Check try's count-in is over.
    canvas.hidden = phase === 'done' && !spec.runway;
    Object.assign(canvas.dataset, { phase, beat: beat ? beat.n : '', index: beat ? beat.index : '', blocks, clicks: sounded });
  }

  function frame() {
    frameId = null;
    if (stopped || !canvas.isConnected) return;
    draw();
    frameId = requestAnimationFrame(frame);
  }

  return {
    attach(parent) {
      if (stopped) return;
      parent.appendChild(canvas);
      // The strip is new height on the page, and a long step can start it below the fold.
      canvas.scrollIntoView({ block: 'nearest' });
      if (frameId === null) frameId = requestAnimationFrame(frame);
    },
    stop() {
      stopped = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      canvas.remove();
    },
  };
}
