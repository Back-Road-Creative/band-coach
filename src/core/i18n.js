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
  'update.checking': 'Checking…',
  'update.devBuild': 'This is a development build ({version}).',
  'update.upToDate': "You're running the latest version ({version}).",
  'update.behind': 'Version {version} is out. ',
  'update.error': "Couldn't reach the update server. ",
  'update.downloadLinkText': 'Download the current version',
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
