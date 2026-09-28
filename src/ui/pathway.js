// "Your keyboard path" panel: lists the five src/core/pathway.js steps
// (setup, lesson, song, check, return), marks the current one, and offers
// ONE action that goes there. Every step's outcome text carries the
// src/instruments/kbd-pathway.js "Not yet checked by a player" label until a
// real player's review lands in the review ledger -- teaching content is
// never claimed reviewed just because this panel shows it. P3: once
// 'return' has BOTH a retained (any song, a day later) and a transfer
// (a different song, any time) row, pathwayState() reports 'complete'; with
// only retained evidence in hand it instead offers the transfer song (in
// Check mode, never re-offering the same-song recheck) -- see the
// extraHtml block below for how the two results render.
import { pathwayState } from '../core/pathway.js';
import { reviewItems as kbdPathwayOutcomes, outcomeReviewed, transferSongFor, RETAINED_TEXT, TRANSFER_TEXT, TRANSFER_DONE_TEXT, COMPLETE_TEXT } from '../instruments/kbd-pathway.js';
import { songFor } from '../instruments/kbd-songs.js';
import { starterSongs } from '../song/starter/index.js';
import { requestOpenSong } from './songs.js';
import { t } from '../core/i18n.js';

// Literal step-name lookup (never string-built) so the static i18n scan
// (tests/unit/i18n-app-keys.test.mjs) sees every t() id this file calls.
const STEP_NAMES = {
  setup: t('pathway.step.setup'),
  lesson: t('pathway.step.lesson'),
  song: t('pathway.step.song'),
  check: t('pathway.step.check'),
  return: t('pathway.step.return'),
};

export function register(panels) {
  panels.register({
    id: 'pathway',
    name: t('pathway.title'),
    tag: t('pathway.tag'),
    color: '#7fb3ff',
    mount(el, api) {
      // Read the level from DB.mods.kbd, not api.mod(), because the panel
      // may open while another mod shows (e.g. a nav click reached it, not
      // only the kbd options button).
      const db = api.db();
      const level = (db.mods && db.mods.kbd && db.mods.kbd.level) || 1;
      const ps = pathwayState({ events: db.events, sessions: db.sessions, midiProof: api.midiProof(), level, now: Date.now() });
      const outcomes = kbdPathwayOutcomes();
      const song = songFor(level);
      const starter = song ? starterSongs.find((s) => s.id === song.songId) : null;
      const title = starter ? starter.title : (song ? song.songId : '');

      const li = outcomes.map((outcome) => {
        const isCurrent = outcome.value.step === ps.step;
        const unreviewed = !outcomeReviewed(outcome.id);
        return '<li data-step="' + outcome.value.step + '"'
          + (isCurrent ? ' aria-current="step" class="pathway-current"' : '') + '>'
          + '<strong>' + STEP_NAMES[outcome.value.step] + '</strong>'
          + (isCurrent ? ' <span class="pathway-here">' + t('pathway.current') + '</span>' : '')
          + ' -- ' + outcome.value.text + (unreviewed ? ' <span class="pathway-unreviewed" role="note">' + t('review.unreviewed') + '</span>' : '')
          + '</li>';
      }).join('');

      // P3: seenSongIds is every songId any kbd song-source event carries --
      // "a transfer song the learner has not seen" -- passed to
      // transferSongFor so it never re-offers a song already played, only
      // falling back to the anchor-only exclusion when nothing else is
      // unlocked (see that function's own comment).
      const seenSongIds = (db.events || []).filter((ev) => ev && ev.instrument === 'kbd' && ev.source === 'song' && typeof ev.songId === 'string').map((ev) => ev.songId);
      let transferEntry = null;
      if (ps.step === 'return' && ps.action.kind === 'transfer') transferEntry = transferSongFor(level, ps.checkSongId, seenSongIds);
      const transferStarter = transferEntry ? starterSongs.find((s) => s.id === transferEntry.songId) : null;
      const transferTitle = transferStarter ? transferStarter.title : (transferEntry ? transferEntry.songId : '');

      let actionHtml = '';
      const kind = ps.action.kind;
      if (kind === 'connect-midi' || kind === 'trainer') {
        actionHtml = '<button type="button" id="pathwayAction">' + t('pathway.action.trainer') + '</button>';
      } else if (kind === 'open-song' && song) {
        actionHtml = '<button type="button" id="pathwayAction">' + t('pathway.action.song', { title: title }) + '</button>';
      } else if ((kind === 'check-song' || kind === 'recheck') && song) {
        actionHtml = '<button type="button" id="pathwayAction">' + t('pathway.action.check', { title: title }) + '</button>';
      } else if (kind === 'wait') {
        actionHtml = '<p class="pathway-wait">' + t('pathway.action.wait', { date: new Date(ps.action.dueAt).toLocaleDateString() }) + '</p>';
      } else if (kind === 'transfer' && transferEntry) {
        actionHtml = '<button type="button" id="pathwayAction">' + t('pathway.action.check', { title: transferTitle }) + '</button>';
      }

      // P3: 'return' and 'complete' both fall past the five listed steps
      // above (kbd-pathway.js's OUTCOMES stays five long -- see its own
      // comment), so their extra copy renders here instead, using the same
      // "Not yet checked by a player" label. The panel shows BOTH results
      // (retained, transfer) whenever pathwayState has evidence for them --
      // a retained result can appear mid-'return' (action 'transfer'), the
      // transfer result only once 'complete'.
      let extraHtml = '';
      if (ps.retainedAt !== undefined) {
        extraHtml += '<p class="pathway-retained" role="note">' + RETAINED_TEXT.text
          + ' <span class="pathway-unreviewed" role="note">' + RETAINED_TEXT.label + '</span></p>';
      }
      if (ps.step === 'complete') {
        extraHtml += '<p class="pathway-transfer-done" role="note">' + TRANSFER_DONE_TEXT.text
          + ' <span class="pathway-unreviewed" role="note">' + TRANSFER_DONE_TEXT.label + '</span></p>'
          + '<p class="pathway-complete" role="note">' + COMPLETE_TEXT.text
          + ' <span class="pathway-unreviewed" role="note">' + COMPLETE_TEXT.label + '</span></p>';
      } else if (kind === 'transfer' && transferEntry) {
        extraHtml += '<p class="pathway-transfer" role="note">' + TRANSFER_TEXT.text
          + ' <span class="pathway-unreviewed" role="note">' + TRANSFER_TEXT.label + '</span></p>';
      }

      el.innerHTML = '<div class="panel-pathway">'
        + '<h2 id="pathwayHeading" tabindex="-1">' + t('pathway.title') + '</h2>'
        + '<ol class="pathway-steps">' + li + '</ol>'
        + actionHtml
        + extraHtml
        + '</div>';

      el.querySelector('#pathwayHeading').focus();

      const actionBtn = el.querySelector('#pathwayAction');
      if (actionBtn) {
        actionBtn.addEventListener('click', () => {
          if (kind === 'connect-midi' || kind === 'trainer') { api.setMod('kbd'); return; }
          if (kind === 'open-song' && song) { requestOpenSong(api, song.songId, undefined, 'kbd', 'kbd'); api.openPanel('songs'); return; }
          if ((kind === 'check-song' || kind === 'recheck') && song) { requestOpenSong(api, song.songId, undefined, 'kbd', 'kbd', 'check'); api.openPanel('songs'); return; }
          if (kind === 'transfer' && transferEntry) { requestOpenSong(api, transferEntry.songId, undefined, 'kbd', 'kbd', 'check'); api.openPanel('songs'); return; }
        });
      }
    },
  });
}
