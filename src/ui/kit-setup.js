import { PIECES } from '../instruments/drum-kit.js';
import { sanitizeKitPrefs } from '../instruments/how/kit-presets.js';
import { t } from '../core/i18n.js';

export function renderKitSetup(host, raw, onChange) {
  host.replaceChildren();
  let prefs = sanitizeKitPrefs(raw);
  const save = patch => { prefs = sanitizeKitPrefs({ ...prefs, ...patch }); onChange(prefs); };
  const legend = document.createElement('legend'); legend.textContent = t('kit.setup'); host.appendChild(legend);
  const label = (id, text, input) => {
    input.id = id;
    const row = document.createElement('label'); row.htmlFor = id;
    row.append(input, document.createTextNode(' ' + text)); host.appendChild(row);
  };
  const select = document.createElement('select');
  for (const id of ['standard', 'compact']) {
    const option = document.createElement('option'); option.value = id; option.textContent = t('kit.' + id); select.appendChild(option);
  }
  select.value = prefs.preset;
  select.addEventListener('change', () => save({ preset: select.value }));
  label('kitPreset', t('kit.layout'), select);
  const check = (id, text, checked, change) => {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', () => change(input.checked)); label(id, text, input);
  };
  check('kitLeftHanded', t('kit.leftHanded'), prefs.leftHanded, leftHanded => save({ leftHanded }));
  const note = document.createElement('p'); note.className = 'small'; note.textContent = t('kit.visibility'); host.appendChild(note);
  for (const piece of PIECES) check('kitShow-' + piece.id, t('kit.piece.' + piece.id), !prefs.hiddenPieces.includes(piece.id), visible => {
    save({ hiddenPieces: visible ? prefs.hiddenPieces.filter(id => id !== piece.id) : [...prefs.hiddenPieces, piece.id] });
  });
}
