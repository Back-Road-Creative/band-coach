// Open-request store and the "Play it on…" card row, split out of src/ui/songs.js so
// songs/review.js and editor.js can import them without looping back through songs.js.
import { INSTRUMENTS } from '../../instruments/index.js';
import { feasibility } from '../../song/feasibility.js';

const READY_INSTRUMENTS = INSTRUMENTS.filter((i) => i.status === 'ready');

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'text') node.textContent = attrs[k];
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
    else node.setAttribute(k, attrs[k]);
  }
  (children || []).forEach((c) => { if (c) node.appendChild(c); });
  return node;
}

// "Play it on…" row (plan D8): one card per ready instrument with a
// feasibility badge (src/song/feasibility.js -- itself built only on
// fitToInstrument()'s real result, never a guessed score). Module-level and
// exported (not a mountSongsPanel closure) so the review screen
// (src/ui/songs/review.js) renders the exact same row as songs.js's
// renderPlayItOn(), without this panel's own practice-session state.
// `onPick(instrument)` fires when a card is clicked; each caller passes its
// own handler.
export function renderPlayItOnCards(song, partId, currentInstrumentId, onPick) {
  const section = el('section', { class: 'panel-songs-play-on', 'aria-label': 'Play it on…' });
  section.appendChild(el('h5', { text: 'Play it on…' }));
  const list = el('ul', { class: 'panel-songs-play-on-list' });
  READY_INSTRUMENTS.forEach((instrument) => {
    const f = feasibility(song, partId, instrument);
    const isCurrent = instrument.id === currentInstrumentId;
    const card = el('li', {
      class: 'panel-songs-instrument-card' + (isCurrent ? ' panel-songs-instrument-card-current' : ''),
    });
    const btn = el('button', {
      type: 'button',
      class: 'panel-songs-instrument-btn',
      title: f.detail,
      onclick: () => onPick(instrument),
    });
    btn.appendChild(el('span', { class: 'panel-songs-instrument-name', text: instrument.name }));
    btn.appendChild(el('span', { class: 'panel-songs-badge', 'data-feasibility': f.level, text: f.label }));
    card.appendChild(btn);
    list.appendChild(card);
  });
  section.appendChild(list);
  return section;
}

// A cross-panel "open this song's lesson next time Songs is shown" request
// (used by src/ui/learn.js's "Practise this" button, since a panel only
// ever gets its OWN mounted instance -- there is no direct call from one
// panel's module into another's running closure). Backed by this panel's
// own saved-data slot (api.store, see src/ui/panels.js's sanitizePanelData
// contract: a plain, <=256KB JSON object, silently dropped if malformed),
// so it survives exactly as long as a real click-through would need and no
// longer -- mountSongsPanel's show() below reads it once and clears it.
export const OPEN_REQUEST_STORE_ID = 'songs-open-request';
// returnTo (C11a): an optional mod id to hand back to api.setMod() once this
// lesson reaches its end (renderPractice's 'Back to practice' below) --
// omitted by every caller before this one (capture's 'Make it a lesson',
// the editor, songs/review.js), which is exactly why it is the 5th,
// optional parameter rather than a change to any of their call sites.
// mode (P2): an optional lesson mode ('rehearse'/'check') the keyboard
// pathway panel's Check-step action hands off, so a learner following the
// panel lands straight in Check mode rather than Learn -- omitted by every
// earlier caller, which is why it is the 6th, optional parameter.
export function requestOpenSong(api, songId, partId, instrumentId, returnTo, mode) {
  api.store(OPEN_REQUEST_STORE_ID).set({ songId, partId: partId || null, instrumentId: instrumentId || null, returnTo: returnTo || null, mode: mode || null });
}
