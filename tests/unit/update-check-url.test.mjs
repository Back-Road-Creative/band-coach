// The update check renders version.json's "download" field as a link the learner clicks, so
// the field is untrusted input from the network. Only an https link to the project's own
// GitHub release / Pages hosts may become that link; anything else must fall back to the
// known-good release asset. Driven through checkForUpdate (the real entry point), not a helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, FALLBACK_DOWNLOAD_URL } from '../../src/core/update-check.js';

async function downloadFor(download) {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ version: '1.4.0', download }) });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'behind');
  return result.downloadUrl;
}

// [given, rendered]: the link handed to the page is the parsed-and-normalised href, so the string
// that was checked is the string that gets rendered (no second parse of the raw text).
const ACCEPTED = [
  ['https://github.com/Back-Road-Creative/band-coach/releases/download/v1.4.0/band-coach.html', 'https://github.com/Back-Road-Creative/band-coach/releases/download/v1.4.0/band-coach.html'],
  ['https://back-road-creative.github.io/band-coach/band-coach.html', 'https://back-road-creative.github.io/band-coach/band-coach.html'],
  ['https://GitHub.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html', 'https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html'],
  // the default port written out is the same host; it is accepted on purpose and rendered without it
  ['https://github.com:443/Back-Road-Creative/band-coach/', 'https://github.com/Back-Road-Creative/band-coach/'],
];
for (const [url, rendered] of ACCEPTED) {
  test(`accepts the trusted link ${url}`, async () => {
    assert.equal(await downloadFor(url), rendered);
  });
}

const REJECTED = {
  'javascript: scheme': 'javascript:alert(1)',
  'data: scheme': 'data:text/html,<script>alert(1)</script>',
  'plain http on an allowed host': 'http://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html',
  'a different host': 'https://example.test/get-the-file',
  'a subdomain of an allowed host appended to a bad one': 'https://github.com.evil.test/band-coach.html',
  'a look-alike host with the name as a suffix': 'https://evilgithub.com/band-coach.html',
  'a subdomain of an allowed host': 'https://www.github.com/band-coach.html',
  'userinfo that hides the real host': 'https://github.com@evil.test/',
  'userinfo on an allowed host': 'https://user:pw@github.com/Back-Road-Creative/band-coach/',
  'a username only on an allowed host': 'https://user@github.com/Back-Road-Creative/band-coach/',
  'an explicit port': 'https://github.com:8443/Back-Road-Creative/band-coach/',
  'a protocol-relative link': '//github.com/Back-Road-Creative/band-coach/',
  'a relative path': '/band-coach.html',
  'garbage text': 'not a url at all',
  'the empty string': '',
  'a number': 42,
  'an object': { href: 'https://github.com/' },
  'null': null,
};
for (const [name, bad] of Object.entries(REJECTED)) {
  test(`falls back to the release asset for ${name}`, async () => {
    assert.equal(await downloadFor(bad), FALLBACK_DOWNLOAD_URL);
  });
}

test('a missing download field falls back to the release asset', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ version: '1.4.0' }) });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.downloadUrl, FALLBACK_DOWNLOAD_URL);
});

test('a caller-supplied fallback is what a rejected link falls back to', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ version: '1.4.0', download: 'javascript:alert(1)' }) });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl, fallbackDownloadUrl: 'https://github.com/x/y' });
  assert.equal(result.downloadUrl, 'https://github.com/x/y');
});
