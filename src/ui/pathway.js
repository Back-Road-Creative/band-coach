// "Your keyboard path" panel: lists the five src/core/pathway.js steps
// (setup, lesson, song, check, return), marks the current one, and offers
// ONE action that goes there. Every step's outcome text carries the
// src/instruments/kbd-pathway.js "Not yet checked by a player" label until a
// real player's review lands in the review ledger -- teaching content is
// never claimed reviewed just because this panel shows it.
import { pathwayState } from '../core/pathway.js';
import { reviewItems as kbdPathwayOutcomes, outcomeReviewed } from '../instruments/kbd-pathway.js';
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
          + ' -- ' + outcome.value.text + (unreviewed ? ' ' + t('review.unreviewed') : '')
          + '</li>';
      }).join('');

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
      }

      el.innerHTML = '<div class="panel-pathway">'
        + '<h2 id="pathwayHeading" tabindex="-1">' + t('pathway.title') + '</h2>'
        + '<ol class="pathway-steps">' + li + '</ol>'
        + actionHtml
        + '</div>';

      el.querySelector('#pathwayHeading').focus();

      const actionBtn = el.querySelector('#pathwayAction');
      if (actionBtn) {
        actionBtn.addEventListener('click', () => {
          if (kind === 'connect-midi' || kind === 'trainer') { api.setMod('kbd'); return; }
          if (kind === 'open-song' && song) { requestOpenSong(api, song.songId, undefined, 'kbd', 'kbd'); api.openPanel('songs'); return; }
          if ((kind === 'check-song' || kind === 'recheck') && song) { requestOpenSong(api, song.songId, undefined, 'kbd', 'kbd', 'check'); api.openPanel('songs'); return; }
        });
      }
    },
  });
}
