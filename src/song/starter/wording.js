// The `licence` and `source` wording every built-in tune shares (index.js,
// folk.js), kept in one place so a tune's provenance reads the same everywhere.
export const PUBLIC_DOMAIN = 'Public domain';

export function traditional(origin) {
  return `Traditional ${origin} melody of unknown authorship; this transcription was made for Band Coach.`;
}

export function composed(name, note) {
  return `Melody by ${name}${note ? ` (${note})` : ''}; this transcription was made for Band Coach.`;
}
