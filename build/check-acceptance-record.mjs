// Checks docs/release-acceptance-record.md against a tag's commit.
//   node build/check-acceptance-record.mjs <record.md> <full-or-short-sha>
// The newest candidate is the LAST "## Candidate:" section. It must name the
// sha, and no row in it may be open unless it says `**device-only: <why>**`.
// A commit cannot hold its own sha, so from the CLI the named candidate may also
// be an ancestor of the tag whose changes up to the tag touch docs/ only (the
// "docs(release): record candidate" commit the tag goes on).
// Called by release.yml (before publish) and release-consistency.yml; tested by
// tests/unit/release-record-check.test.mjs.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OPEN = /\*\*(open\b|Pending\.|Not run)/i;
const DEVICE = /\*\*device-only\b([^*]*)\*\*/i;

const exact = (full) => (h) => (full.startsWith(h.toLowerCase()) ? null : 'not the tag commit');

export function checkRecord(text, sha, { accepts = exact(String(sha).toLowerCase()) } = {}) {
  const problems = [];
  const lines = text.split('\n');
  let start = -1;
  lines.forEach((l, i) => { if (/^## Candidate:/.test(l)) start = i; });
  if (start === -1) return { ok: false, problems: ['no "## Candidate:" section in the record'] };
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  const section = lines.slice(start, end);
  const full = String(sha).toLowerCase();
  const named = section.join('\n').match(/\b[0-9a-f]{7,40}\b/gi) || [];
  const why = [];
  if (!named.some((h) => { const r = accepts(h); if (r) why.push(`${h}: ${r}`); return !r; })) {
    problems.push(`newest candidate (${lines[start]}) does not name ${full.slice(0, 7)} (tag commit ${full})${why.length ? `; ${why.join('; ')}` : ''}`);
  }
  for (const l of section) {
    if (!l.startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const row = cells[0];
    const value = cells.slice(1).join(' | ');
    const dev = value.match(DEVICE);
    if (dev) {
      if (!dev[1].replace(/^[\s:]+/, '').trim()) problems.push(`row "${row}": device-only needs a reason (**device-only: why only a person on a device can close it**)`);
    } else if (OPEN.test(value)) problems.push(`row "${row}": still open and agent-executable; close it, or mark it **device-only: <reason>**`);
  }
  return { ok: problems.length === 0, problems };
}

// Accept the tag commit itself, or an ancestor of it with only docs/ changed since.
export function gitAccepts(tag, cwd) {
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  const full = git('rev-parse', '--verify', '-q', `${tag}^{commit}`).stdout.trim() || String(tag).toLowerCase();
  return (h) => {
    if (full.startsWith(h.toLowerCase())) return null;
    const c = git('rev-parse', '--verify', '-q', `${h}^{commit}`).stdout.trim();
    if (!c) return 'not a commit in this repository';
    if (git('merge-base', '--is-ancestor', c, full).status !== 0) return 'not an ancestor of the tag';
    const after = git('diff', '--name-only', c, full).stdout.split('\n').filter((f) => f && !f.startsWith('docs/'));
    return after.length ? `changed after it outside docs/: ${after.join(', ')}` : null;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, sha] = process.argv.slice(2);
  if (!file || !sha) { console.error('usage: check-acceptance-record.mjs <record.md> <sha>'); process.exit(2); }
  const r = checkRecord(readFileSync(file, 'utf8'), sha, { accepts: gitAccepts(sha, process.cwd()) });
  for (const p of r.problems) console.error(`::error::acceptance record: ${p}`);
  if (r.ok) console.log(`acceptance record names ${sha.slice(0, 7)} and has no open agent-executable rows`);
  process.exit(r.ok ? 0 : 1);
}
