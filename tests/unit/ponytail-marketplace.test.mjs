// Supply-chain boundary: installing this optional developer tool must resolve
// the reviewed upstream commit without adding hooks or enabling it for everyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const catalog = () => JSON.parse(readFileSync(new URL('.claude-plugin/marketplace.json', root), 'utf8'));

test('Ponytail resolves only the reviewed upstream commit', () => {
  const marketplace = catalog();
  assert.equal(marketplace.name, 'band-coach-reviewed');
  assert.equal(marketplace.plugins.length, 1);
  const plugin = marketplace.plugins[0];
  assert.equal(plugin.name, 'ponytail');
  assert.deepEqual(plugin.source, {
    source: 'github',
    repo: 'DietrichGebert/ponytail',
    sha: '96608e078b2d5ea607c5c3b8b5a54d1c1fba6846',
  });
});

test('the catalog cannot auto-enable Ponytail or extend its executable components', () => {
  const plugin = catalog().plugins[0];
  assert.equal(plugin.defaultEnabled, false);
  assert.equal(plugin.strict, false); // upstream manifest alone defines components
  assert.deepEqual(Object.keys(plugin).sort(), ['defaultEnabled', 'description', 'name', 'source', 'strict']);
  // Catalog discovery is not permission to enable plugins in shared settings.
  const settingsFile = new URL('.claude/settings.json', root);
  const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
  for (const [id, enabled] of Object.entries(settings.enabledPlugins || {})) {
    if (id.startsWith('ponytail@')) assert.equal(enabled, false, 'Ponytail must remain a local opt-in');
  }
});
