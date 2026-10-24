// The one HTML escaper and the one XML escaper. Kept separate on purpose: HTML
// writes an apostrophe as the numeric &#39; (older HTML parsers do not know
// &apos;), XML writes the named &apos;.
const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escapes text for HTML element content or a quoted attribute value.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

// Escapes the five characters XML text content and quoted attribute values reserve.
export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
