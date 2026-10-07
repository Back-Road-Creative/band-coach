// Picks the test-family scripts a pull request has to run, from tests/families.json
// and the changed-file list.
//
//   node build/ci-select.mjs [--base <ref>] [file ...]     prints e.g. `test:unit test:build`
//
// Files come from the arguments, else `git diff --name-only <base>...HEAD`
// (base defaults to origin/main). Robust by construction: a path no rule
// recognises, an empty list, or a git failure all print `test:all`, so a gap in
// the manifest costs minutes, never coverage. A pushed main always runs
// `npm test` (see ci.yml); this only narrows pull_request runs. Only `node:`
// built-ins.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// `**` crosses directories, `*` stays inside one.
export function globToRegExp(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*');
  return new RegExp(`^${re}$`);
}

export function loadManifest() {
  return JSON.parse(readFileSync(join(here, '..', 'tests', 'families.json'), 'utf8'));
}

// The first rule whose glob matches a file decides that file's families; one
// unmatched file selects everything. Families print in manifest order; selecting
// every family prints the single `all` script.
export function selectFamilies(files, manifest = loadManifest()) {
  const list = (files || []).map((f) => String(f).trim().replace(/^\.\//, '')).filter(Boolean);
  if (!list.length) return [manifest.all];
  const rules = manifest.rules.map((r) => ({ run: r.run, res: r.match.map(globToRegExp) }));
  const picked = new Set();
  for (const f of list) {
    const rule = rules.find((r) => r.res.some((re) => re.test(f)));
    if (!rule) return [manifest.all];
    for (const fam of rule.run) picked.add(fam);
  }
  const names = Object.keys(manifest.families);
  if (names.every((n) => picked.has(n))) return [manifest.all];
  return names.filter((n) => picked.has(n)).map((n) => manifest.families[n].script);
}

function changedFiles(base) {
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  } catch {
    return []; // unreadable diff selects everything
  }
}

function main(argv) {
  const files = [];
  let base = 'origin/main';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') base = argv[++i] ?? base;
    else files.push(argv[i]);
  }
  process.stdout.write(selectFamilies(files.length ? files : changedFiles(base)).join(' ') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
