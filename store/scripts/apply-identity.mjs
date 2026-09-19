// Overlays the three Partner-Center identity values onto the checked-in
// electron-builder.json, writing electron-builder.generated.json (gitignored).
//
// electron-builder's AppX target reads appx.identityName / appx.publisher /
// appx.publisherDisplayName as plain strings from the resolved config; it
// does NOT expand "${env.X}" macros for these fields (only artifact-name
// patterns go through that macro expander — see
// node_modules/app-builder-lib/out/targets/AppxTarget.js, which assigns
// `this.options` straight from packager.config.appx with no substitution).
// So a literal "${env.BC_IDENTITY_NAME}" in the checked-in config would ship
// as-is and fail AppX's identityName character-set validation. Instead this
// script does the substitution itself, before electron-builder ever sees the
// config, and falls back to the safe placeholders already in the base file
// when an env var is unset or empty.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const BASE_CONFIG = join(root, 'electron-builder.json');
const OUT_CONFIG = join(root, 'electron-builder.generated.json');

const OVERRIDES = {
  identityName: 'BC_IDENTITY_NAME',
  publisher: 'BC_PUBLISHER',
  publisherDisplayName: 'BC_PUBLISHER_DISPLAY_NAME',
};

export function applyIdentity(env = process.env) {
  const config = JSON.parse(readFileSync(BASE_CONFIG, 'utf8'));
  const applied = {};
  for (const [field, envName] of Object.entries(OVERRIDES)) {
    const value = env[envName];
    if (typeof value === 'string' && value.trim() !== '') {
      config.appx[field] = value;
      applied[field] = 'env';
    } else {
      applied[field] = 'placeholder';
    }
  }
  return { config, applied };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { config, applied } = applyIdentity();
  writeFileSync(OUT_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log('wrote ' + OUT_CONFIG);
  for (const [field, source] of Object.entries(applied)) {
    console.log('  appx.' + field + ' <- ' + source);
  }
}
