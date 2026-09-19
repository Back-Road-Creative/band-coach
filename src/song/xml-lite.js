// A tiny, safe XML reader for MusicXML import.
//
// `node --test` has no DOMParser, and this module must stay injectable-free
// (no globals, no DOM), so it implements just enough of XML to read a plain
// MusicXML score: elements, attributes, text, entities, comments and CDATA.
// A DOCTYPE is recognised and skipped WITHOUT expanding any entity it
// declares — this parser never resolves external entities or DTD subsets,
// by construction, not by configuration. Depth and total-length limits guard
// against pathological or hostile input. Malformed input throws a plain
// Error with no jargon.
//
// API: parseXml(text, opts?) -> root element node
//   element(node, name)/elements(node, name) -> first/all matching children
//   text(node) -> concatenated text of direct text children
//   childText(node, name) -> text(element(node, name)), or undefined
//   attr(node, name, fallback) -> attribute value, or fallback
// A node is { type: 'element', name, attrs: {[k]: string}, children: Node[] }
// or { type: 'text', value: string }.

const DEFAULT_MAX_DEPTH = 200;
const DEFAULT_MAX_LENGTH = 8_000_000;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

class Scanner {
  constructor(text) { this.text = text; this.pos = 0; this.len = text.length; }
  peek(offset = 0) { return this.text[this.pos + offset]; }
  startsWith(s) { return this.text.startsWith(s, this.pos); }
  atEnd() { return this.pos >= this.len; }
  skipWhitespace() { while (this.pos < this.len && /\s/.test(this.text[this.pos])) this.pos += 1; }
  fail(msg) {
    const upTo = this.text.slice(0, this.pos);
    const line = upTo.split('\n').length;
    const col = this.pos - upTo.lastIndexOf('\n');
    throw new Error(`malformed XML at line ${line}, column ${col}: ${msg}`);
  }
}

const isNameStart = (ch) => ch !== undefined && /[A-Za-z_:]/.test(ch);
const isNameChar = (ch) => ch !== undefined && /[A-Za-z0-9_:.\-]/.test(ch);

function readName(sc) {
  const start = sc.pos;
  if (!isNameStart(sc.peek())) sc.fail('expected an element or attribute name');
  sc.pos += 1;
  while (isNameChar(sc.peek())) sc.pos += 1;
  return sc.text.slice(start, sc.pos);
}

function decodeEntities(raw, sc) {
  if (raw.indexOf('&') === -1) return raw;
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== '&') { out += ch; i += 1; continue; }
    const semi = raw.indexOf(';', i);
    if (semi === -1) sc.fail('unterminated entity reference');
    const body = raw.slice(i + 1, semi);
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const digits = isHex ? body.slice(2) : body.slice(1);
      if (!digits || !/^[0-9a-fA-F]+$/.test(digits) || (!isHex && !/^[0-9]+$/.test(digits))) sc.fail(`invalid numeric character reference &${body};`);
      out += String.fromCodePoint(parseInt(digits, isHex ? 16 : 10));
    } else if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)) {
      out += NAMED_ENTITIES[body];
    } else {
      sc.fail(`unknown entity reference &${body}; (only amp, lt, gt, quot, apos and numeric references are supported)`);
    }
    i = semi + 1;
  }
  return out;
}

function skipComment(sc) {
  sc.pos += 4; // past '<!--'
  const end = sc.text.indexOf('-->', sc.pos);
  if (end === -1) sc.fail('unterminated comment');
  sc.pos = end + 3;
}

function readCData(sc) {
  sc.pos += 9; // past '<![CDATA['
  const end = sc.text.indexOf(']]>', sc.pos);
  if (end === -1) sc.fail('unterminated CDATA section');
  const value = sc.text.slice(sc.pos, end);
  sc.pos = end + 3;
  return value;
}

function skipDoctype(sc) {
  // Skip <!DOCTYPE ...>, including a bracketed internal subset, without
  // interpreting anything inside it (no entity expansion).
  sc.pos += 2; // past '<!'
  let depth = 0;
  while (!sc.atEnd()) {
    const ch = sc.peek();
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    else if (ch === '>' && depth <= 0) { sc.pos += 1; return; }
    sc.pos += 1;
  }
  sc.fail('unterminated DOCTYPE declaration');
}

function skipProcessingInstruction(sc) {
  sc.pos += 2; // past '<?'
  const end = sc.text.indexOf('?>', sc.pos);
  if (end === -1) sc.fail('unterminated processing instruction');
  sc.pos = end + 2;
}

function readAttrs(sc) {
  const attrs = {};
  for (;;) {
    sc.skipWhitespace();
    const ch = sc.peek();
    if (ch === '/' || ch === '>' || ch === undefined) return attrs;
    const name = readName(sc);
    sc.skipWhitespace();
    if (sc.peek() !== '=') sc.fail(`expected '=' after attribute name "${name}"`);
    sc.pos += 1;
    sc.skipWhitespace();
    const quote = sc.peek();
    if (quote !== '"' && quote !== "'") sc.fail(`attribute "${name}" value must be quoted`);
    sc.pos += 1;
    const start = sc.pos;
    const endQuote = sc.text.indexOf(quote, start);
    if (endQuote === -1) sc.fail(`unterminated attribute value for "${name}"`);
    const raw = sc.text.slice(start, endQuote);
    sc.pos = endQuote + 1;
    if (Object.prototype.hasOwnProperty.call(attrs, name)) sc.fail(`duplicate attribute "${name}"`);
    attrs[name] = decodeEntities(raw, sc);
  }
}

function parseElement(sc, depth, maxDepth) {
  if (depth > maxDepth) sc.fail(`element nesting exceeds the limit of ${maxDepth}`);
  sc.pos += 1; // past '<'
  const name = readName(sc);
  const attrs = readAttrs(sc);
  sc.skipWhitespace();
  if (sc.startsWith('/>')) { sc.pos += 2; return { type: 'element', name, attrs, children: [] }; }
  if (sc.peek() !== '>') sc.fail(`expected '>' to close start tag <${name}>`);
  sc.pos += 1;

  const children = [];
  for (;;) {
    if (sc.atEnd()) sc.fail(`unexpected end of input, unclosed tag <${name}>`);
    if (sc.startsWith('</')) {
      const closeStart = sc.pos;
      sc.pos += 2;
      const closeName = readName(sc);
      sc.skipWhitespace();
      if (sc.peek() !== '>') sc.fail(`expected '>' to close end tag </${closeName}>`);
      sc.pos += 1;
      if (closeName !== name) { sc.pos = closeStart; sc.fail(`mismatched closing tag: expected </${name}> but found </${closeName}>`); }
      return { type: 'element', name, attrs, children };
    }
    if (sc.startsWith('<!--')) { skipComment(sc); continue; }
    if (sc.startsWith('<![CDATA[')) { children.push({ type: 'text', value: readCData(sc) }); continue; }
    if (sc.startsWith('<?')) { skipProcessingInstruction(sc); continue; }
    if (sc.startsWith('<!')) { skipDoctype(sc); continue; }
    if (sc.peek() === '<') { children.push(parseElement(sc, depth + 1, maxDepth)); continue; }
    const start = sc.pos;
    const nextLt = sc.text.indexOf('<', sc.pos);
    const end = nextLt === -1 ? sc.len : nextLt;
    const raw = sc.text.slice(start, end);
    sc.pos = end;
    const value = decodeEntities(raw, sc);
    if (value !== '') children.push({ type: 'text', value });
  }
}

export function parseXml(text, opts = {}) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;
  if (typeof text !== 'string') throw new Error('parseXml: input must be a string');
  if (text.length > maxLength) throw new Error(`parseXml: input too large (${text.length} characters, limit ${maxLength})`);

  const sc = new Scanner(text);
  sc.skipWhitespace();
  while (sc.startsWith('<?') || sc.startsWith('<!--') || sc.startsWith('<!')) {
    if (sc.startsWith('<?')) skipProcessingInstruction(sc);
    else if (sc.startsWith('<!--')) skipComment(sc);
    else skipDoctype(sc);
    sc.skipWhitespace();
  }
  if (sc.atEnd() || sc.peek() !== '<') sc.fail('expected a root element');
  const root = parseElement(sc, 0, maxDepth);
  sc.skipWhitespace();
  while (sc.startsWith('<!--')) { skipComment(sc); sc.skipWhitespace(); }
  if (!sc.atEnd()) sc.fail('unexpected content after the root element');
  return root;
}

export function elements(node, name) {
  if (!node || !Array.isArray(node.children)) return [];
  return node.children.filter((c) => c.type === 'element' && c.name === name);
}
export function element(node, name) { return elements(node, name)[0]; }
export function text(node) {
  if (!node || !Array.isArray(node.children)) return '';
  return node.children.filter((c) => c.type === 'text').map((c) => c.value).join('');
}
export function childText(node, name) {
  const el = element(node, name);
  return el === undefined ? undefined : text(el);
}
export function attr(node, name, fallback) {
  if (!node || !node.attrs || !(name in node.attrs)) return fallback;
  return node.attrs[name];
}
