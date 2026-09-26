// i18n scaffold -- English only ships. This is the seam a later locale
// plugs into, not a translation sweep: today it carries the strings that
// have already been moved through t() (see src/app.js's options/backup/
// update-check area), and grows as more slices convert. Pure -- no DOM,
// no AudioContext -- so callers own rendering, this only owns text.
//
// Every id is a stable dotted string (never the English text itself, so a
// later locale can key off it without caring what English says). A missing
// id must never throw or blank the UI -- the id itself comes back, which is
// ugly but visible and debuggable, never a silent hole. A missing {param}
// is left in the string verbatim for the same reason: better a visible
// placeholder than text that quietly loses information.
export const en = {
  'backup.saved': 'Backup saved to your downloads. Keep that file somewhere safe.',
  'backup.restored': 'Backup restored.',
  'backup.readError': 'That file could not be read.',
  'backup.confirmRestore': 'Restore this backup? It will replace your current progress.',
  'reset.progressCleared': '{name} progress cleared. Back to level 1.',
  // Keyboard mod's help panel text. States BOTH computer-key rows in plain
  // words -- a w s e d f t g y h u j k play C4 up to C5, z x c v b n m play
  // C3 up to B3 -- and says outright that this is screen and computer-key
  // practice, never a claim of a real keyboard (see src/core/pckeys.js for
  // the mapping this describes).
  // hintFor()'s truthful fallback for any mod that draws a hand-built staff
  // (MODS[mod].staff === true) and nothing else -- no lit-key diagram, no
  // fretboard, no hole diagram. Read the staff, not a key: this must never
  // say a key is "lit up" on a screen that never drew one.
  'hint.staffNote': 'Read {label} on the staff and play it. Hold it steady.',
  'kbd.help': 'Keyboard: plug in a MIDI keyboard and press Connect, or click the keys on screen, or use the computer keys as screen and computer-key practice (not a real keyboard) -- a w s e d f t g y h u j k play C4 up to C5, and z x c v b n m play C3 up to B3 (naturals only, no sharps on that row). New keys light up the first two times; after that you find them yourself. Hands together: a real MIDI keyboard, or two hands on the computer keys (one on each row), checks both notes and grades them exactly; a microphone only ever hears one note at a time, so that grading is approximate.',
  'update.checking': 'Checking…',
  'update.devBuild': 'This is a development build ({version}).',
  'update.upToDate': "You're running the latest version ({version}).",
  'update.behind': 'Version {version} is out. ',
  'update.error': "Couldn't reach the update server. ",
  'update.downloadLinkText': 'Download the current version',

  // Static page labels -- headings, button text, help copy that src/app.js
  // never rewrites at runtime. Applied once at startup by applyStaticLabels
  // in src/app.js (this file stays DOM-free, see the header comment) from a
  // data-i18n="id" attribute on the element; the same English text is also
  // left sitting in src/index.html so the page still reads correctly before
  // that startup call runs, or if JS never runs at all.
  'app.subtitle': 'One coach, many instruments. It teaches where things are, then the moves between them, picks every next exercise from your own results, and watches your energy so practice stays fresh.',
  'nav.label': 'Main',
  'nav.practice': 'Practice',
  'nav.songs': 'Songs',
  'nav.progress': 'Progress',
  'nav.instrument': 'Instrument: {name}',
  'nav.chooseInstrument': 'Choose an instrument',
  'nav.settings': 'Settings',
  'settings.title': 'Settings',
  'settings.look': 'Look and names',
  'settings.backups': 'Backups and reset',
  'settings.updates': 'Updates',
  'settings.how': 'How this works',
  'songs.addRow': 'Add a song',
  // A9: the collapsible <summary> wrapping the song list, Carry-on banner
  // and Assignments (challenges/band packs) so opening a song puts its
  // lesson in the first screen instead of below the whole library -- see
  // the .panel-songs-library <details> in mountSongsPanel().
  'songs.libraryToggle': 'Your song library',
  'picker.tools': 'Tools',
  'setup.button': 'Set up input',
  'setup.connect': 'Connect',
  'setup.midiDetails': 'MIDI details',
  'setup.inputLabel': 'Input',
  'setup.defaultMic': 'Default microphone',
  'setup.checkMic': 'Check my microphone',

  // "How to play it" panel (src/ui/fingerings.js): the routing fallback for
  // an instrument this app cannot yet draw guidance for, and the badge that
  // marks a fingering/curriculum record no musician has checked yet (see
  // src/instruments/review.js's isReviewed -- null or reference-only
  // provenance both count as unreviewed).
  'fingerings.unavailable': "Guidance for this instrument isn't ready here yet.",
  'review.unreviewed': 'Not yet checked by a musician.',
  'review.unreviewedWithRef': 'Not yet checked by a musician (noted against {reference}).',

  'break.back': "I'm back, resume",
  'break.snooze': 'Keep going 5 more minutes',
  'break.end': 'End session',
  'stage.tapPad': 'Tap here, or press space',
  'stage.replay': 'Hear it again',
  'stage.showMe': 'Show me',
  'side.end': 'End session',
  'side.energyEyebrow': 'Your energy this session',
  'energy.full': 'Fresh',
  'side.easier': 'Make it easier',
  'side.harder': 'Skip ahead',
  'side.feedbackEyebrow': 'Instant feedback',
  'stats.last20': 'last 20',
  'stats.streak': 'streak',
  'stats.rtLabel': 'sec to answer',
  'side.weakEyebrow': 'What the coach is leaning on',
  'side.backupDismiss': 'Dismiss',
  'rail.reset': 'Reset this instrument (clears progress)',
  'rail.backupSave': 'Save a backup',
  'rail.backupRestore': 'Restore a backup',
  'rail.checkUpdates': 'Check for updates',
  'rail.updateHelp': 'Asks the Band Coach website for the latest version number. Sends nothing about your playing.',
};

const locales = { en };
let activeLocale = 'en';

// Adds/merges strings into a locale (creating it if new) without discarding
// what that locale already had -- so a translation can be filled in one
// slice at a time, same as the English table itself is being grown.
export function registerLocale(code, table) {
  locales[code] = Object.assign({}, locales[code] || {}, table || {});
}

// Only ever called with a locale that registerLocale has already populated
// (or 'en', which always exists); an unknown code is left as a no-op rather
// than throwing, since a bad locale code must never take down the app.
export function setLocale(code) {
  if (locales[code]) activeLocale = code;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (whole, key) => (Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole));
}

// Looks up id in the active locale, falling back to English (never to the
// id) when the active locale hasn't got that string yet -- a partial
// translation must never regress to raw ids for the strings it hasn't
// reached. Only when NEITHER has it does the id itself come back.
export function t(id, params) {
  const table = locales[activeLocale] || locales.en;
  const str = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : locales.en[id];
  if (typeof str !== 'string') return id;
  return interpolate(str, params);
}
