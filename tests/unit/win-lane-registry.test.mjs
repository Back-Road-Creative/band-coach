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

test('U4 registry files are exactly the *.win.mjs files on disk', () => {
  assert.deepEqual(lane.registry.map((r) => r.file).sort(), onDisk());
});

test('U4 each registry entry has a distinct id and its file exports that id', async () => {
  assert.equal(new Set(lane.registry.map((r) => r.id)).size, lane.registry.length, 'ids are distinct');
  assert.ok(lane.registry.length >= 1, 'the registry is not empty');
  for (const { id, file } of lane.registry) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    assert.equal(mod.id, id, `${file} exports id ${id}`);
    assert.equal(typeof mod.run, 'function', `${file} exports run`);
    assert.equal(typeof mod.verdict, 'function', `${file} exports verdict`);
  }
});
