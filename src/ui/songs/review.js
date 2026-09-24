// The review screen a learned song lands on: moved out of src/ui/learn.js
// (its renderResult, the handoff helpers clickPanelButton/openSongsPanel/
// openEditorPanel/openPlayalongPanel, and practiceGate) as its own module --
// P3-2, a behaviour-preserving move. This lets Songs reuse the exact same
// result view later (P3-4) instead of duplicating it. No DOM or behaviour
// change here: every panel-learn-* class and every button label stays
// exactly as it was in learn.js.
import { renderPlayItOnCards, requestOpenSong } from '../songs.js';
import { requestOpenInEditor } from '../editor.js';
import { requestPlayalongRecording } from '../playalong.js';

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

// Pure decision behind renderReview()'s "Practise this" button: a song whose
// transcription still has unresolved check items (warnings, from
// report.needsCheck) must not be sent straight to practice with doubtful
// notes uncorrected -- it has to go through "Fix it up" first. No DOM in it,
// tested the same way src/ui/editor.js's chooseSaveTarget is.
export function practiceGate(warnings) {
  const list = Array.isArray(warnings) ? warnings : [];
  if (!list.length) return { allowed: true, reason: null };
  return { allowed: false, reason: 'Fix up the ' + list.length + ' flagged note' + (list.length === 1 ? '' : 's') + ' first, then practise.' };
}

// Opening another panel from a review screen: the caller only ever has its
// own mounted panel instance (src/ui/panels.js), never the shared panels
// registry app.js owns, so it cannot call panels.open() itself. The one
// real, already-shipping way any panel switches to another is
// src/app.js's panelApi.openPanel(id). Where api carries no openPanel (a
// page that never wired panel switching in), this returns false so the
// caller can still tell the learner in plain words where to go, rather than
// silently doing nothing.
function clickPanelButton(api, panelId) {
  if (api && typeof api.openPanel === 'function') { api.openPanel(panelId); return true; }
  return false;
}

// makeHandoffs(api): the three ways a review sends its song on -- practise
// it in Songs, fix it up in the editor, or play along with the original
// recording. Built once per panel here, so both learn.js today and Songs
// later (P3-4) share the exact same wiring instead of keeping two copies.
export function makeHandoffs(api) {
  function openSongsPanel(songId, partId, instrumentId) {
    requestOpenSong(api, songId, partId, instrumentId);
    return clickPanelButton(api, 'songs');
  }
  // "Fix it up": hands the just-learned song to the fuller note-editing
  // panel, the one with note-editing ops (src/song/edit.js) this module
  // deliberately does not reimplement.
  function openEditorPanel(songId, needsCheck) {
    requestOpenInEditor(api, songId, needsCheck);
    return clickPanelButton(api, 'editor');
  }
  // "Play along with this recording" (audio sources only, where a decoded
  // buffer exists): hands the SAME decoded PCM to Play Along's beat/chord
  // analysis and loop, rather than asking the learner to re-pick the file
  // there. In-memory handoff (requestPlayalongRecording()), not api.store --
  // audio is far too big for the 256KB panel-data budget.
  function openPlayalongPanel(rec) {
    requestPlayalongRecording(rec);
    return clickPanelButton(api, 'playalong');
  }
  return { openSongsPanel, openEditorPanel, openPlayalongPanel };
}

// renderReview(resultEl, opts): the shared result view a learned song lands
// on, wherever it was learned -- a check list, a confidence-coloured note
// strip when the result carries per-note confidence, the "Play it on…"
// instrument-card row, and the "Practise this" / "Fix it up" / "Play along
// with this recording" buttons. `onPractise`/`onEditNotes`/`onPlayAlong` do
// the actual panel hand-off (see makeHandoffs above) and report back
// whether a panel switch really happened, so `say` (the caller's own status
// line) can tell the learner where to go by hand if it did not.
export function renderReview(resultEl, { song, warnings, audioRec, api, onPractise, onEditNotes, onPlayAlong, say }) {
  resultEl.innerHTML = '';
  resultEl.hidden = false;
  resultEl.appendChild(el('h4', { text: song.title }));

  if (warnings.length) {
    const list = el('ul', { class: 'panel-learn-checklist' });
    warnings.forEach((w) => list.appendChild(el('li', { text: w })));
    resultEl.appendChild(list);
  }

  // Confidence colours: only ever drawn from a real per-note confidence
  // transcribe() already attached (src/song/transcribe.js's eventsToNotes --
  // every transcribed note carries one). A notation import's notes carry
  // none, and this strip is simply omitted rather than inventing a number --
  // never show a confidence that was not measured.
  const partId = song.parts[0] ? song.parts[0].id : null;
  const notes = partId ? song.parts[0].notes : [];
  if (notes.length && notes.every((n) => typeof n.confidence === 'number')) {
    const strip = el('div', { class: 'panel-learn-confidence-strip', 'aria-label': 'Note confidence' });
    notes.forEach((n) => {
      const level = n.confidence >= 0.7 ? 'high' : n.confidence >= 0.4 ? 'medium' : 'low';
      strip.appendChild(el('span', {
        class: 'panel-learn-confidence-note',
        'data-confidence': level,
        title: Math.round(n.confidence * 100) + '% confident',
      }));
    });
    resultEl.appendChild(strip);
  }

  if (partId) {
    resultEl.appendChild(renderPlayItOnCards(song, partId, typeof api.mod === 'function' ? api.mod() : null, (instrument) => onPractise(song.id, partId, instrument.id)));
  }

  // A song with unresolved check items (warnings) cannot be sent straight to
  // practice with doubtful notes uncorrected -- see practiceGate, above. The
  // button stays visible (never a dead end) but disabled, with the reason
  // spelled out in plain language right next to it.
  const gate = practiceGate(warnings);
  const practiseBtn = el('button', { type: 'button', class: 'panel-learn-practise-btn', text: 'Practise this' });
  if (!gate.allowed) practiseBtn.disabled = true;
  practiseBtn.addEventListener('click', () => {
    if (!gate.allowed) return;
    const opened = onPractise(song.id, partId, null);
    if (!opened) say('Saved "' + song.title + '". Open the Songs panel to practise it.');
  });
  resultEl.appendChild(practiseBtn);
  if (!gate.allowed) resultEl.appendChild(el('p', { class: 'panel-learn-practise-gate-reason', text: gate.reason }));

  // "Fix it up" -- every result, notation or audio, can be sent to the
  // fuller note-editing panel. Any unresolved check items ride along
  // (requestOpenInEditor/loadReport, src/ui/editor.js) so the editor shows
  // the learner the SAME check list rather than losing it.
  const fixItUpBtn = el('button', { type: 'button', class: 'panel-learn-fixitup-btn', text: 'Fix it up' });
  fixItUpBtn.addEventListener('click', () => {
    const opened = onEditNotes(song.id, warnings);
    if (!opened) say('Saved "' + song.title + '". Open Record a tune to fix it up.');
  });
  resultEl.appendChild(fixItUpBtn);

  // "Play along with this recording" -- only ever shown where a decoded
  // audio buffer actually exists (the file door's own recording; the mic
  // door's recorder captures pitch frames only, never raw audio, so it has
  // none to hand over -- never claim a hand-off the app cannot back up).
  if (audioRec) {
    const playAlongBtn = el('button', { type: 'button', class: 'panel-learn-playalong-btn', text: 'Play along with this recording' });
    playAlongBtn.addEventListener('click', () => {
      const opened = onPlayAlong(audioRec);
      if (!opened) say('Saved "' + song.title + '". Open Play Along to use this recording.');
    });
    resultEl.appendChild(playAlongBtn);
  }
}
