// Applies a review packet's downloaded result file (see build/review-packet.mjs)
// to src/instruments/review-ledger.js's LEDGER literal -- the only file this
// script ever writes, and the only thing in it this script ever touches. It
// never writes record-level `provenance` (src/instruments/*.js) -- that stays
// a separate, hand-edited step (see README.md's "Beginner pathway status").
//
// Refusal is all-or-nothing: any problem in the file (unknown schema,
// missing/blank reference or reviewedBy, a malformed or non-calendar
// reviewedAt, a duplicate or unknown id, a stale rev) refuses the whole file
// and writes nothing, listing every problem it found. A `correction` row is
// never written and never deletes anything -- it is only reported, for a
// human to act on by editing the source the row points at.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { reviewItems } from './review-packet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LEDGER_PATH = join(here, '..', 'src', 'instruments', 'review-ledger.js');

const SCHEMA = 'band-coach-review-result/1';

function isBlank(s) {
  return typeof s !== 'string' || s.trim().length === 0;
}

// A real calendar date, not just YYYY-MM-DD shaped -- catches e.g.
// 2026-02-30, which /^\d{4}-\d{2}-\d{2}$/ alone lets through.
function isRealCalendarDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Validates a result file's shape and content against the current items for
// its instrument. Returns { ok, errors } -- never throws -- so a caller can
// report every problem at once instead of stopping at the first.
export function validateResult(result, items) {
  const errors = [];
  if (!result || typeof result !== 'object') {
    return { ok: false, errors: ['result must be an object'] };
  }
  if (result.schema !== SCHEMA) errors.push('unsupported schema "' + result.schema + '" (expected "' + SCHEMA + '")');
  if (isBlank(result.reference)) errors.push('reference is missing or empty');
  if (isBlank(result.reviewedBy)) errors.push('reviewedBy is missing or empty');
  if (typeof result.reviewedAt !== 'string' || !isRealCalendarDate(result.reviewedAt)) errors.push('reviewedAt must be a real calendar date in YYYY-MM-DD form');
  if (!Array.isArray(result.items)) {
    errors.push('items must be an array');
    return { ok: errors.length === 0, errors };
  }
  const currentById = new Map(items.map((i) => [i.id, i]));
  const seen = new Set();
  for (const item of result.items) {
    if (!item || typeof item !== 'object' || !item.id || !item.rev) {
      errors.push('an item is missing id or rev');
      continue;
    }
    if (item.verdict !== 'pass' && item.verdict !== 'correction') {
      errors.push(item.id + ': verdict must be "pass" or "correction"');
      continue;
    }
    if (seen.has(item.id)) {
      errors.push('duplicate id ' + item.id);
      continue;
    }
    seen.add(item.id);
    const current = currentById.get(item.id);
    if (!current) {
      errors.push('unknown id ' + item.id);
      continue;
    }
    if (item.rev !== current.rev) {
      errors.push('stale ' + item.id + ': result rev ' + item.rev + ', current rev ' + current.rev);
    }
  }
  return { ok: errors.length === 0, errors };
}

// String-aware brace match: walks value starting just after openIndex (which
// must point at the opening '{'), skipping over string literals so a brace
// inside a quoted reference never ends the match early, and returns the
// index of the matching close brace.
function matchBrace(source, openIndex) {
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('apply-review: unterminated LEDGER object literal');
}

const LEDGER_ANCHOR = 'export const LEDGER = Object.freeze(';

// Locates the single `export const LEDGER = Object.freeze({ ... });`
// statement in ledgerSource and returns its anchor/open/close/end indices.
// Shared by readLedgerFromSource and rewriteLedgerSource so both agree on
// exactly the same span -- the one thing this script is allowed to touch.
function locateLedgerStatement(ledgerSource) {
  const anchorIndex = ledgerSource.indexOf(LEDGER_ANCHOR);
  if (anchorIndex === -1) throw new Error('apply-review: could not find "' + LEDGER_ANCHOR + '" in the ledger source');
  const secondIndex = ledgerSource.indexOf(LEDGER_ANCHOR, anchorIndex + 1);
  if (secondIndex !== -1) throw new Error('apply-review: found more than one LEDGER anchor');
  const openIndex = ledgerSource.indexOf('{', anchorIndex);
  const closeIndex = matchBrace(ledgerSource, openIndex);
  const afterClose = ledgerSource.indexOf(');', closeIndex);
  if (afterClose === -1) throw new Error('apply-review: could not find the closing ");" after the LEDGER object literal');
  return { anchorIndex, openIndex, closeIndex, afterClose };
}

// Reads the ledger object literal actually present in ledgerSource --
// always the true starting point for a merge, so applying a second result
// on top of a first one's output keeps the first's entries without the
// caller having to thread the ledger object through by hand. The object
// literal is always JSON.stringify output (or the original `{}`), so a
// plain JSON.parse is safe.
function readLedgerFromSource(ledgerSource) {
  const { openIndex, closeIndex } = locateLedgerStatement(ledgerSource);
  return JSON.parse(ledgerSource.slice(openIndex, closeIndex + 1));
}

// Rewrites only the `export const LEDGER = Object.freeze({ ... });` literal
// in ledgerSource to reflect ledger, leaving every other byte untouched.
// Re-applying to this function's own output works: it locates the anchor
// fresh each time and never assumes anything about what is inside it.
function rewriteLedgerSource(ledgerSource, ledger) {
  const { anchorIndex, afterClose } = locateLedgerStatement(ledgerSource);
  const before = ledgerSource.slice(0, anchorIndex);
  const after = ledgerSource.slice(afterClose + 2);
  const replacement = LEDGER_ANCHOR + JSON.stringify(ledger, null, 2) + ');';
  return before + replacement + after;
}

// Applies one review result to a ledger. Throws (never partially writes) if
// validateResult finds any problem; on success returns the new source text
// plus which ids were actually applied (`pass` rows) and which were only
// reported (`correction` rows). currentLedger defaults to the ledger object
// actually present in ledgerSource (see readLedgerFromSource) rather than a
// separately-imported LEDGER, so applying a second result on top of a
// first's output keeps the first's entries with no extra plumbing; pass
// currentLedger explicitly only to override that.
export function applyReviewResult(result, { ledgerSource, currentLedger, items } = {}) {
  const resolvedItems = items || reviewItems(result && result.instrument);
  const { ok, errors } = validateResult(result, resolvedItems);
  if (!ok) throw new Error('apply-review: refusing this result file:\n' + errors.map((e) => '  - ' + e).join('\n'));
  const ledger = { ...(currentLedger !== undefined ? currentLedger : readLedgerFromSource(ledgerSource)) };
  const applied = [];
  const corrections = [];
  for (const item of result.items) {
    if (item.verdict === 'correction') {
      corrections.push({ id: item.id, note: item.note });
      continue;
    }
    ledger[item.id] = {
      reference: result.reference,
      reviewedBy: result.reviewedBy,
      reviewedAt: result.reviewedAt,
      contentRev: item.rev,
      reviewedRev: item.rev
    };
    applied.push(item.id);
  }
  const source = rewriteLedgerSource(ledgerSource, ledger);
  return { source, applied, corrections };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const ledgerFlagIndex = args.indexOf('--ledger');
  const ledgerPath = ledgerFlagIndex >= 0 ? args[ledgerFlagIndex + 1] : DEFAULT_LEDGER_PATH;
  const resultPath = args.find((a, i) => a !== '--ledger' && args[i - 1] !== '--ledger');
  try {
    if (!resultPath) throw new Error('usage: node build/apply-review.mjs <result.json> [--ledger <path>]');
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    const ledgerSource = readFileSync(ledgerPath, 'utf8');
    const { source, applied, corrections } = applyReviewResult(result, { ledgerSource });
    if (applied.length === 0) {
      console.log('No pass rows in this result file -- nothing written.');
    } else {
      writeFileSync(ledgerPath, source, 'utf8');
      console.log('Applied: ' + applied.join(', '));
    }
    if (corrections.length) {
      console.log('Corrections (not written -- act on these by hand):');
      for (const c of corrections) console.log('  ' + c.id + ': ' + c.note);
    }
    console.log('Review the diff and open a PR');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
