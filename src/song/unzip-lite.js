// A minimal ZIP reader plus its own raw-DEFLATE (RFC 1951) decoder.
//
// Why hand-rolled: Band Coach ships as one offline HTML file with no
// dependencies, and `.mxl` (compressed MusicXML) entries are typically
// DEFLATE-compressed. `DecompressionStream('deflate-raw')` exists in modern
// browsers but not all of them (and not in this test runner), so inflate is
// implemented here from the RFC rather than relied upon. No compression
// (writing zips) — read-only, just enough to open an `.mxl` archive.
//
// API:
//   inflateRaw(bytes) -> Uint8Array                 raw DEFLATE decompress
//   readZipEntries(bytes) -> [{ name, method, compressedSize,
//     uncompressedSize, localOffset }]               central directory listing
//   readZipEntryData(bytes, entry) -> Uint8Array      decompressed entry bytes
//   readMxlRootEntry(bytes) -> { name, bytes }        the score inside an .mxl,
//     found via META-INF/container.xml, falling back to the first
//     non-META-INF .musicxml/.xml entry

// ---- bit-level reading for DEFLATE -----------------------------------

class BitReader {
  constructor(bytes) { this.bytes = bytes; this.bytePos = 0; this.bitPos = 0; }
  readBit() {
    if (this.bytePos >= this.bytes.length) throw new Error('unexpected end of deflate stream');
    const bit = (this.bytes[this.bytePos] >> this.bitPos) & 1;
    this.bitPos += 1;
    if (this.bitPos === 8) { this.bitPos = 0; this.bytePos += 1; }
    return bit;
  }
  readBits(n) { // DEFLATE packs non-Huffman fields LSB-first
    let value = 0;
    for (let i = 0; i < n; i += 1) value |= this.readBit() << i;
    return value >>> 0;
  }
  align() { if (this.bitPos !== 0) { this.bitPos = 0; this.bytePos += 1; } }
}

// ---- canonical Huffman decoding ---------------------------------------
// DEFLATE codes are packed MOST-significant-bit first (unlike every other
// field in the stream), so decoding reads one bit at a time and builds the
// code by shifting left, per RFC 1951 section 3.1.1 / 3.2.2.

function buildHuffman(lengths) {
  const maxBits = lengths.reduce((m, l) => Math.max(m, l), 0);
  const blCount = new Array(maxBits + 1).fill(0);
  for (const l of lengths) if (l > 0) blCount[l] += 1;
  const nextCode = new Array(maxBits + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) { code = (code + blCount[bits - 1]) << 1; nextCode[bits] = code; }
  const table = new Map();
  for (let sym = 0; sym < lengths.length; sym += 1) {
    const len = lengths[sym];
    if (len === 0) continue;
    const c = nextCode[len]; nextCode[len] += 1;
    table.set(len * 65536 + c, sym);
  }
  return table;
}

function decodeSymbol(br, huff) {
  let code = 0;
  for (let len = 1; len <= 16; len += 1) {
    code = (code << 1) | br.readBit();
    const sym = huff.get(len * 65536 + code);
    if (sym !== undefined) return sym;
  }
  throw new Error('malformed deflate stream: no matching Huffman code');
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function fixedLitHuffman() {
  const lengths = new Array(288);
  for (let i = 0; i <= 143; i += 1) lengths[i] = 8;
  for (let i = 144; i <= 255; i += 1) lengths[i] = 9;
  for (let i = 256; i <= 279; i += 1) lengths[i] = 7;
  for (let i = 280; i <= 287; i += 1) lengths[i] = 8;
  return buildHuffman(lengths);
}
function fixedDistHuffman() { return buildHuffman(new Array(30).fill(5)); }

function readDynamicTrees(br) {
  const hlit = br.readBits(5) + 257;
  const hdist = br.readBits(5) + 1;
  const hclen = br.readBits(4) + 4;
  const clLengths = new Array(19).fill(0);
  for (let i = 0; i < hclen; i += 1) clLengths[CL_ORDER[i]] = br.readBits(3);
  const clHuff = buildHuffman(clLengths);
  const lengths = [];
  while (lengths.length < hlit + hdist) {
    const sym = decodeSymbol(br, clHuff);
    if (sym < 16) { lengths.push(sym); continue; }
    if (sym === 16) {
      if (lengths.length === 0) throw new Error('malformed deflate stream: repeat code with nothing to repeat');
      const repeat = br.readBits(2) + 3;
      const prev = lengths[lengths.length - 1];
      for (let i = 0; i < repeat; i += 1) lengths.push(prev);
      continue;
    }
    if (sym === 17) { const repeat = br.readBits(3) + 3; for (let i = 0; i < repeat; i += 1) lengths.push(0); continue; }
    if (sym === 18) { const repeat = br.readBits(7) + 11; for (let i = 0; i < repeat; i += 1) lengths.push(0); continue; }
    throw new Error('malformed deflate stream: invalid code-length symbol');
  }
  return {
    litHuff: buildHuffman(lengths.slice(0, hlit)),
    distHuff: buildHuffman(lengths.slice(hlit, hlit + hdist)),
  };
}

function inflateBlock(br, out, litHuff, distHuff) {
  for (;;) {
    const sym = decodeSymbol(br, litHuff);
    if (sym < 256) { out.push(sym); continue; }
    if (sym === 256) return;
    const lenIdx = sym - 257;
    if (lenIdx < 0 || lenIdx >= LENGTH_BASE.length) throw new Error('malformed deflate stream: invalid length symbol');
    const length = LENGTH_BASE[lenIdx] + br.readBits(LENGTH_EXTRA[lenIdx]);
    const distSym = decodeSymbol(br, distHuff);
    if (distSym < 0 || distSym >= DIST_BASE.length) throw new Error('malformed deflate stream: invalid distance symbol');
    const distance = DIST_BASE[distSym] + br.readBits(DIST_EXTRA[distSym]);
    const start = out.length - distance;
    if (start < 0) throw new Error('malformed deflate stream: back-reference before the start of output');
    for (let i = 0; i < length; i += 1) out.push(out[start + i]);
  }
}

export function inflateRaw(bytes) {
  const br = new BitReader(bytes);
  const out = [];
  const fixedLit = fixedLitHuffman();
  const fixedDist = fixedDistHuffman();
  let final = false;
  while (!final) {
    final = br.readBit() === 1;
    const btype = br.readBits(2);
    if (btype === 0) {
      br.align();
      const len = bytes[br.bytePos] | (bytes[br.bytePos + 1] << 8);
      br.bytePos += 4; // LEN (2 bytes) + NLEN (2 bytes, ones-complement of LEN, unchecked)
      for (let i = 0; i < len; i += 1) out.push(bytes[br.bytePos + i]);
      br.bytePos += len;
    } else if (btype === 1) {
      inflateBlock(br, out, fixedLit, fixedDist);
    } else if (btype === 2) {
      const { litHuff, distHuff } = readDynamicTrees(br);
      inflateBlock(br, out, litHuff, distHuff);
    } else {
      throw new Error('malformed deflate stream: reserved block type 3');
    }
  }
  return Uint8Array.from(out);
}

// ---- ZIP container ------------------------------------------------------

function u16(bytes, pos) { return bytes[pos] | (bytes[pos + 1] << 8); }
function u32(bytes, pos) { return (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) >>> 0; }

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN_LEN = 22;
const MAX_COMMENT_LEN = 65535;

function findEndOfCentralDirectory(bytes) {
  const minPos = Math.max(0, bytes.length - EOCD_MIN_LEN - MAX_COMMENT_LEN);
  for (let i = bytes.length - EOCD_MIN_LEN; i >= minPos; i -= 1) {
    if (u32(bytes, i) === EOCD_SIG) return i;
  }
  throw new Error('not a valid zip archive: end-of-central-directory record not found');
}

export function readZipEntries(bytes) {
  const eocdPos = findEndOfCentralDirectory(bytes);
  const totalEntries = u16(bytes, eocdPos + 10);
  const cdOffset = u32(bytes, eocdPos + 16);
  const entries = [];
  let pos = cdOffset;
  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < totalEntries; i += 1) {
    if (u32(bytes, pos) !== CENTRAL_SIG) throw new Error('not a valid zip archive: malformed central directory entry');
    const method = u16(bytes, pos + 10);
    const compressedSize = u32(bytes, pos + 20);
    const uncompressedSize = u32(bytes, pos + 24);
    const nameLen = u16(bytes, pos + 28);
    const extraLen = u16(bytes, pos + 30);
    const commentLen = u16(bytes, pos + 32);
    const localOffset = u32(bytes, pos + 42);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntryData(bytes, entry) {
  const pos = entry.localOffset;
  if (u32(bytes, pos) !== LOCAL_SIG) throw new Error(`not a valid zip archive: malformed local file header for "${entry.name}"`);
  const nameLen = u16(bytes, pos + 26);
  const extraLen = u16(bytes, pos + 28);
  const dataStart = pos + 30 + nameLen + extraLen;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Uint8Array.from(compressed);
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error(`unsupported zip compression method ${entry.method} for "${entry.name}" (only stored and deflate are supported)`);
}

export function readMxlRootEntry(bytes) {
  const entries = readZipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let rootName;
  const containerEntry = byName.get('META-INF/container.xml');
  if (containerEntry) {
    const containerXml = new TextDecoder('utf-8').decode(readZipEntryData(bytes, containerEntry));
    const match = containerXml.match(/<rootfile\b[^>]*\bfull-path="([^"]+)"/);
    if (match) rootName = match[1];
  }
  if (!rootName) {
    const candidate = entries.find((e) => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name));
    if (candidate) rootName = candidate.name;
  }
  if (!rootName) throw new Error('no MusicXML entry found inside the .mxl archive');
  const entry = byName.get(rootName);
  if (!entry) throw new Error(`the .mxl container.xml points at "${rootName}", which is not in the archive`);
  return { name: rootName, bytes: readZipEntryData(bytes, entry) };
}
