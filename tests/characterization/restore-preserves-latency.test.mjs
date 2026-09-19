// Restoring a backup made on another machine must not overwrite this
// device's own audio-latency calibration (DB.latencyMs, set by "Calibrate
// timing"). doImportProgress (src/app.js) rebuilds DB with
// `sanitizeDB(result.db)`, which takes whatever latencyMs (or none) the
// imported backup carries -- silently discarding this device's number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('importProgress keeps this device latencyMs even when the backup has a different one', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Calibrate this device to a known, distinctive value.
  await page.evaluate('window.__coach.db().latencyMs = 77');

  const otherMachineBackup = await page.evaluate(`
    JSON.stringify({
      format: 'band-coach-progress',
      formatVersion: 1,
      appVersion: 'unknown',
      exportedAt: new Date().toISOString(),
      db: Object.assign({}, window.__coach.db(), { latencyMs: 250 }),
    })
  `);

  const result = await page.evaluate(`window.__coach.importProgress(${JSON.stringify(otherMachineBackup)})`);
  assert.ok(result.ok, 'the backup is well-formed and import succeeds');

  const latencyMs = await page.evaluate('window.__coach.db().latencyMs');
  assert.equal(latencyMs, 77, 'this device kept its own calibrated latency, not the backup one');
});

test('importProgress falls back to a fresh default when this device has never calibrated', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate('window.__coach.db().latencyMs = 0');

  const otherMachineBackup = await page.evaluate(`
    JSON.stringify({
      format: 'band-coach-progress',
      formatVersion: 1,
      appVersion: 'unknown',
      exportedAt: new Date().toISOString(),
      db: Object.assign({}, window.__coach.db(), { latencyMs: 250 }),
    })
  `);

  await page.evaluate(`window.__coach.importProgress(${JSON.stringify(otherMachineBackup)})`);
  const latencyMs = await page.evaluate('window.__coach.db().latencyMs');
  assert.equal(latencyMs, 0, 'no prior calibration on this device means no latency carries over from the backup either');
});
