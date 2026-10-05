// If a release corrupts a learner's progress, someone has to pull the bad file, put the last good
// one back and tell the people who already downloaded it -- at a moment when nobody has time to
// work out how. docs/release-recovery.md is that runbook, and it must not quietly go missing or
// become unreachable from the README's "Releasing" section (the place a maintainer looks first).
// It also must not describe machinery this repo does not have: every workflow it names must exist,
// and the Store steps, which this repo cannot verify, must say so rather than invent facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const DOC = 'docs/release-recovery.md';
const doc = existsSync(new URL(DOC, root)) ? readFileSync(new URL(DOC, root), 'utf8') : null;
const readme = readFileSync(new URL('README.md', root), 'utf8');

function need() {
  assert.ok(doc !== null, `${DOC} must exist: the runbook for withdrawing a bad release`);
  return doc;
}

test('docs/release-recovery.md exists', () => {
  need();
});

test('README links to the runbook from its Releasing section', () => {
  const start = readme.indexOf('\n## Releasing');
  assert.notEqual(start, -1, 'README must still have a "Releasing" section');
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  assert.match(section, /\]\(docs\/release-recovery\.md\)/, 'the Releasing section must link to docs/release-recovery.md');
});

test('the runbook covers each way a bad release reaches people', () => {
  const d = need();
  assert.match(d, /^## .*GitHub release/im, 'a section on unpublishing or replacing the GitHub release');
  assert.match(d, /gh release (delete|edit)/, 'it must give the actual command to pull the release');
  assert.match(d, /^## .*Pages/im, 'a section on putting the last good Pages copy back');
  assert.match(d, /last good tag/i, 'Pages is redeployed from the last good tag');
  assert.match(d, /^## .*Store/im, 'a section on holding the Store build');
  assert.match(d, /^## .*(message|tell)/im, 'a section with what to tell learners');
  assert.match(d, /^## .*(backup|restore)/im, 'a section on restoring a backup into an older file');
});

test('it warns that the update check cannot pull a learner back to an older version', () => {
  const d = need();
  assert.match(d, /up-to-date/, 'a bad file newer than the live version.json is told it is up to date');
  assert.match(d, /new (patch )?(version|release)/i, 'the way out is a new, higher version');
});

test('it states the refuse-safely behaviour of restoring into an older file', () => {
  const d = need();
  assert.match(d, /newer Band Coach/, 'it must quote the refusal the older file shows');
  assert.match(d, /left (exactly )?as|untouched|nothing (is )?changed/i, 'and say current progress is left alone');
});

test('Store steps are marked unconfirmed, not invented', () => {
  const d = need();
  const from = d.search(/^## .*Store/im);
  const rest = d.slice(from + 1);
  const next = rest.search(/^## /m);
  const store = next === -1 ? rest : rest.slice(0, next);
  assert.match(store, /confirm with JP/i, 'the Store section itself must say "confirm with JP" for the steps this repo cannot verify');
});

test('every workflow the runbook names exists in this repo', () => {
  const d = need();
  const names = [...d.matchAll(/\b([a-z][a-z-]*\.yml)\b/g)].map((m) => m[1]);
  assert.ok(names.includes('pages.yml') && names.includes('release.yml'), 'it must name pages.yml and release.yml');
  for (const n of new Set(names)) {
    assert.ok(existsSync(new URL(`.github/workflows/${n}`, root)), `${n} is named but is not in .github/workflows/`);
  }
});

test('every repo path it links to exists', () => {
  const d = need();
  for (const m of d.matchAll(/\]\(([^)#\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    assert.ok(existsSync(new URL(m[1], new URL(DOC, root))), `broken link: ${m[1]}`);
  }
});
