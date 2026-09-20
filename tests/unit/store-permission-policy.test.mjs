// Unit tests for the pure permission-decision policy used by the Windows
// Store desktop shell's Electron main process (store/main.js). Runs with
// plain `node --test` — no Electron required — same convention as
// tests/unit/store-shell.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAllowed, ALLOWED_PERMISSIONS } from '../../store/lib/permission-policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here));
const APP_FILE_URL = 'file://' + join(repoRoot, 'store', 'app', 'band-coach.html');
const OTHER_FILE_URL = 'file://' + join(repoRoot, 'store', 'app', 'evil.html');

// Origin forms Electron/Chromium is known (or plausible) to report for a
// file:// page: the exact file URL, the bare "file://"/"file:///" scheme,
// and the opaque-origin string "null". None of these should matter on their
// own — only a matching requestingUrl/webContentsUrl should.
const FILE_ORIGIN_FORMS = [APP_FILE_URL, 'file://', 'file:///', 'null', undefined];

test('ALLOWED_PERMISSIONS names exactly media/midi/midiSysex', () => {
  assert.deepEqual(new Set(ALLOWED_PERMISSIONS), new Set(['media', 'midi', 'midiSysex']));
});

for (const permission of ['media', 'midi', 'midiSysex']) {
  for (const requestingOrigin of FILE_ORIGIN_FORMS) {
    test(`allows ${permission} from the app's own file (origin=${String(requestingOrigin)}, via requestingUrl)`, () => {
      assert.equal(
        isAllowed({ permission, requestingOrigin, requestingUrl: APP_FILE_URL, appFileUrl: APP_FILE_URL }),
        true
      );
    });

    test(`allows ${permission} from the app's own file (origin=${String(requestingOrigin)}, via webContentsUrl)`, () => {
      assert.equal(
        isAllowed({ permission, requestingOrigin, webContentsUrl: APP_FILE_URL, appFileUrl: APP_FILE_URL }),
        true
      );
    });

    test(`allows ${permission} when both requestingUrl and webContentsUrl agree (origin=${String(requestingOrigin)})`, () => {
      assert.equal(
        isAllowed({
          permission,
          requestingOrigin,
          requestingUrl: APP_FILE_URL,
          webContentsUrl: APP_FILE_URL,
          appFileUrl: APP_FILE_URL,
        }),
        true
      );
    });
  }
}

test('denies a permission outside the allow-list even from the app file', () => {
  for (const permission of ['geolocation', 'notifications', 'camera', 'clipboard-read', '']) {
    assert.equal(
      isAllowed({ permission, requestingUrl: APP_FILE_URL, appFileUrl: APP_FILE_URL }),
      false,
      `expected ${permission} to be denied`
    );
  }
});

test('denies when requestingOrigin is unambiguously remote, even if a URL field matches', () => {
  for (const requestingOrigin of ['https://evil.example', 'http://evil.example', 'wss://evil.example']) {
    assert.equal(
      isAllowed({
        permission: 'media',
        requestingOrigin,
        requestingUrl: APP_FILE_URL,
        webContentsUrl: APP_FILE_URL,
        appFileUrl: APP_FILE_URL,
      }),
      false
    );
  }
});

test('denies when requestingUrl is remote', () => {
  assert.equal(
    isAllowed({
      permission: 'media',
      requestingUrl: 'https://evil.example/',
      appFileUrl: APP_FILE_URL,
    }),
    false
  );
});

test('denies when webContentsUrl is remote', () => {
  assert.equal(
    isAllowed({
      permission: 'media',
      webContentsUrl: 'https://evil.example/',
      appFileUrl: APP_FILE_URL,
    }),
    false
  );
});

test('denies a different file path', () => {
  assert.equal(
    isAllowed({
      permission: 'media',
      requestingUrl: OTHER_FILE_URL,
      appFileUrl: APP_FILE_URL,
    }),
    false
  );
});

test('denies when requestingUrl and webContentsUrl disagree', () => {
  assert.equal(
    isAllowed({
      permission: 'media',
      requestingUrl: APP_FILE_URL,
      webContentsUrl: OTHER_FILE_URL,
      appFileUrl: APP_FILE_URL,
    }),
    false
  );
});

test('fails closed when neither requestingUrl nor webContentsUrl is provided', () => {
  assert.equal(
    isAllowed({ permission: 'media', requestingOrigin: APP_FILE_URL, appFileUrl: APP_FILE_URL }),
    false
  );
});

test('fails closed on missing/garbage inputs', () => {
  assert.equal(isAllowed(), false);
  assert.equal(isAllowed({}), false);
  assert.equal(isAllowed({ permission: 'media' }), false);
  assert.equal(isAllowed({ permission: 'media', requestingUrl: APP_FILE_URL }), false);
  assert.equal(
    isAllowed({ permission: 'media', requestingUrl: APP_FILE_URL, appFileUrl: '' }),
    false
  );
  assert.equal(
    isAllowed({ permission: 'media', requestingUrl: APP_FILE_URL, appFileUrl: 'not a url' }),
    false
  );
  assert.equal(
    isAllowed({ permission: 'media', requestingUrl: 'not a url', appFileUrl: APP_FILE_URL }),
    false
  );
  assert.equal(
    isAllowed({ permission: null, requestingUrl: APP_FILE_URL, appFileUrl: APP_FILE_URL }),
    false
  );
  assert.equal(
    isAllowed({
      permission: 'media',
      requestingUrl: 123,
      webContentsUrl: APP_FILE_URL,
      appFileUrl: APP_FILE_URL,
    }),
    true // non-string requestingUrl is ignored as a candidate, webContentsUrl still matches
  );
});
