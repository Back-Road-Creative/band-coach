// A learner who wants to check the download needs two things next to it: a
// sha256 file they can run `sha256sum -c` against in their download folder,
// and a signed build-provenance attestation. This pins both in release.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url)), 'utf8');
const stepOf = (name) => {
  const at = text.indexOf(`- name: ${name}`);
  assert.notEqual(at, -1, `no step "${name}"`);
  const end = text.indexOf('\n      - ', at + 1);
  return text.slice(at, end === -1 ? undefined : end);
};

test('the release upload includes band-coach.html.sha256 next to band-coach.html', () => {
  const pub = stepOf('publish GitHub release');
  const create = pub.slice(pub.indexOf('gh release create'));
  assert.match(create, /dist\/release\/band-coach\.html\b/);
  assert.match(create, /band-coach\.html\.sha256/, 'the checksum file must be a release asset');
});

test('the checksum file is sha256sum format against the bare name band-coach.html', () => {
  const pub = stepOf('publish GitHub release');
  assert.match(pub, /cd dist\/release && sha256sum band-coach\.html\)\s*>\s*"\$RUNNER_TEMP\/band-coach\.html\.sha256"/);
});

test('the published checksum is downloaded back and checked in the download folder', () => {
  const proof = stepOf('prove the downloaded release file');
  assert.match(proof, /band-coach\.html\.sha256/);
  assert.match(proof, /sha256sum -c band-coach\.html\.sha256/);
});

test('an attest step covers dist/release/band-coach.html and is pinned to a 40-hex SHA', () => {
  const m = text.match(/uses: actions\/attest-build-provenance@([0-9a-f]{40}) # v\d+\.\d+\.\d+/);
  assert.ok(m, 'actions/attest-build-provenance must be pinned to a 40-hex SHA with a version comment');
  const at = text.indexOf('actions/attest-build-provenance@');
  const step = text.slice(text.lastIndexOf('\n      - ', at), text.indexOf('\n      - ', at));
  assert.match(step, /subject-path: dist\/release\/band-coach\.html/);
  assert.match(step, /github\.event_name == 'push' && github\.ref_type == 'tag'/, 'a dry run attests nothing');
});

test('id-token and attestations write are granted on the job, not the workflow', () => {
  const top = text.match(/^permissions:\n((?:  .*\n)+)/m)[1];
  assert.doesNotMatch(top, /id-token|attestations/);
  const job = text.match(/^  release:\n(?:    .*\n)*?    permissions:\n((?:      .*\n)+)/m)[1];
  assert.match(job, /id-token: write/);
  assert.match(job, /attestations: write/);
});
