// Single source of truth for where the built, self-contained app lives.
// This file only exists after `npm run build`. Every test script in package.json runs that build
// itself (enforced by tests/unit/test-scripts-build-what-they-need.test.mjs), and launchPage()
// fails at once, naming the file, if it is missing; running node --test by hand needs a build first.
import { fileURLToPath } from 'node:url';

export const HTML_PATH = fileURLToPath(new URL('../../dist/band-coach.html', import.meta.url));
