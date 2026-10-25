// Metronome panel (id "metronome"): a steady click at a chosen tempo and bar length. The pure
// maths is in src/core/metronome.js; beats are scheduled a short way ahead on the shared
// AudioContext clock (api.audio()) so the click stays steady even when the page is busy.
import { el } from './dom.js';
import { t } from '../core/i18n.js';
import { clampBpm, beatTimes, MIN_BPM, MAX_BPM } from '../core/metronome.js';

const BEATS_CHOICES = [2, 3, 4, 6];
const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;

function cleanBeats(n) { return BEATS_CHOICES.includes(Number(n)) ? Number(n) : 4; }

export function registerMetronome(panels) {
  panels.register({
    id: 'metronome',
    get name() { return t('metronome.title'); },
    get tag() { return t('metronome.tag'); },
    color: '#e0b05b',
    mount(hostEl, api) {
      const saved = api.store('metronome').get() || {};
      let bpm = clampBpm(saved.bpm === undefined ? 80 : saved.bpm);
      let beats = cleanBeats(saved.beats);
      let timer = null, ctx = null, nextTime = 0, nextBeat = 0, played = 0, flashTimer = null;
      let pending = [];
      const save = () => api.store('metronome').set({ bpm, beats });

      const root = el('div', { class: 'panel-metronome', 'data-running': 'false', 'data-beat': '0' });
      const heading = el('h2', { id: 'metronomeHeading', tabindex: '-1', text: t('metronome.title') });
      const num = el('input', { type: 'number', id: 'metronomeBpm', min: String(MIN_BPM), max: String(MAX_BPM), step: '1', inputmode: 'numeric', value: String(bpm) });
      const range = el('input', { type: 'range', id: 'metronomeSlider', min: String(MIN_BPM), max: String(MAX_BPM), step: '1', value: String(bpm), 'aria-label': t('metronome.tempoSlider') });
      const sel = el('select', { id: 'metronomeBeats' });
      BEATS_CHOICES.forEach((n) => sel.appendChild(el('option', { value: String(n), text: String(n) })));
      sel.value = String(beats);
      const toggle = el('button', { type: 'button', class: 'metronome-toggle', 'aria-pressed': 'false', text: t('metronome.start') });
      const dot = el('div', { class: 'metronome-dot', 'aria-hidden': 'true' });

      const row1 = el('div', { class: 'metronome-row' }, [el('label', { for: 'metronomeBpm', text: t('metronome.tempo') }), num, range]);
      const row2 = el('div', { class: 'metronome-row' }, [el('label', { for: 'metronomeBeats', text: t('metronome.beats') }), sel]);
      [heading, el('p', { class: 'sub', text: t('metronome.intro') }), row1, row2, el('div', { class: 'metronome-row' }, [toggle, dot])].forEach((n) => root.appendChild(n));
      hostEl.appendChild(root);
      if (heading.focus) heading.focus();

      function setBpm(v) { bpm = clampBpm(v); num.value = String(bpm); range.value = String(bpm); save(); }
      num.addEventListener('input', () => { if (num.value !== '' && isFinite(Number(num.value))) { const v = clampBpm(num.value); range.value = String(v); bpm = v; } });
      num.addEventListener('change', () => setBpm(num.value));
      range.addEventListener('input', () => setBpm(range.value));
      sel.addEventListener('change', () => { beats = cleanBeats(sel.value); nextBeat = 0; save(); });

      function click(time, accent) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = accent ? 1500 : 1000;
        g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
        o.connect(g); g.connect(ctx.destination); o.start(time); o.stop(time + 0.06);
      }
      function flash(accent) {
        dot.classList.add('on'); dot.classList.toggle('accent', accent);
        clearTimeout(flashTimer); flashTimer = setTimeout(() => dot.classList.remove('on'), 90);
      }
      function tick() {
        const horizon = ctx.currentTime + LOOKAHEAD_S;
        while (nextTime < horizon) {
          const b = beatTimes(nextTime, bpm, beats, 1, nextBeat)[0];
          click(Math.max(b.time, ctx.currentTime), b.accent); pending.push(b);
          nextBeat = (b.beat + 1) % beats; nextTime = b.time + 60 / bpm;
        }
        while (pending.length && pending[0].time <= ctx.currentTime) { const b = pending.shift(); played++; root.dataset.beat = String(played); flash(b.accent); }
      }
      function start() {
        ctx = api.audio();
        if (!ctx) { api.say(t('metronome.noAudio'), 'no'); return; }
        played = 0; root.dataset.beat = '0'; pending = []; nextBeat = 0; nextTime = ctx.currentTime + 0.05;
        timer = setInterval(tick, TICK_MS); tick();
        root.dataset.running = 'true'; toggle.setAttribute('aria-pressed', 'true'); toggle.textContent = t('metronome.stop');
      }
      function stop() {
        if (timer) { clearInterval(timer); timer = null; }
        pending = []; dot.classList.remove('on');
        root.dataset.running = 'false'; toggle.setAttribute('aria-pressed', 'false'); toggle.textContent = t('metronome.start');
      }
      toggle.addEventListener('click', () => { if (timer) stop(); else start(); });

      return {
        hide: stop,
        destroy() { stop(); clearTimeout(flashTimer); },
      };
    },
  });
}
