// The lane's list of scenarios and the scenario files on disk must agree, so a
// scenario cannot be written and never run (or listed and missing). The files
// are named *.win.mjs on purpose: no npm test glob picks them up, they only
// run in the Windows lane (docs/windows-lane.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as lane from '../acceptance/win/run.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'acceptance', 'win');
const onDisk = () => readdirSync(dir).filter((f) => f.endsWith('.win.mjs')).sort();
// A scenario that needs a person is listed apart from the unattended ones, and still has to be listed.
const everyScenario = [...lane.registry, ...lane.attended];

test('U4 registry and attended files are exactly the *.win.mjs files on disk', () => {
  assert.deepEqual(everyScenario.map((r) => r.file).sort(), onDisk());
});

test('U4 each registry entry has a distinct id and its file exports that id', async () => {
  assert.equal(new Set(everyScenario.map((r) => r.id)).size, everyScenario.length, 'ids are distinct');
  assert.ok(lane.registry.length >= 1, 'the registry is not empty');
  for (const { id, file } of everyScenario) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    assert.equal(mod.id, id, `${file} exports id ${id}`);
    assert.equal(typeof mod.run, 'function', `${file} exports run`);
    assert.equal(typeof mod.verdict, 'function', `${file} exports verdict`);
  }
});
