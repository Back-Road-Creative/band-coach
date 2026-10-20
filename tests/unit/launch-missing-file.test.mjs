// A launch on an HTML file that is not there must fail at once, naming the file and the
// build command -- not spend three 60 s boot attempts ending BOOT_DEADLINE (the CI trial on
// the release lane, which ran without the dev build, did exactly that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchPage } from '../helpers/browser.mjs';

test('launchPage rejects a missing html file quickly, names it and the build, and spawns no browser', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-missing-'));
  const marker = join(dir, 'spawned');
  const fake = join(dir, 'fake-chrome');
  writeFileSync(fake, `#!/bin/sh\ntouch ${marker}\n`);
  chmodSync(fake, 0o755);
  const prev = process.env.CHROME_BIN;
  process.env.CHROME_BIN = fake;
  const missing = join(dir, 'dist', 'band-coach.html');
  const t0 = Date.now();
  try {
    await assert.rejects(() => launchPage(missing), (err) => {
      assert.match(err.message, /band-coach\.html/);
      assert.ok(err.message.includes(missing), 'names the file');
      assert.match(err.message, /npm run build/);
      assert.notEqual(err.code, 'BOOT_DEADLINE');
      return true;
    });
    assert.ok(Date.now() - t0 < 5000, `rejected in ${Date.now() - t0}ms`);
    assert.equal(existsSync(marker), false, 'no browser process was started');
  } finally {
    if (prev === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
