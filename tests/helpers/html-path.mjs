// Single source of truth for where the built, self-contained app lives.
// `npm test`'s `pretest` hook (see package.json) runs `npm run build` first,
// so this file is fresh by the time any test resolves it.
import { fileURLToPath } from 'node:url';

export const HTML_PATH = fileURLToPath(new URL('../../dist/band-coach.html', import.meta.url));
