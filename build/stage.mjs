// Copies the built release file to the drive the five-minute human check is
// run from, so the person testing by hand double-clicks D:\band-coach.html
// instead of walking a \\wsl.localhost path.
//
//   npm run stage                  -> builds dist/release/band-coach.html,
//                                     copies it to $BC_STAGE_DIR (default
//                                     /mnt/d, the Windows D: drive under WSL)
//   BC_STAGE_DIR=/some/dir npm run stage
//
// It never creates the target directory: a missing drive is a mount problem
// to fix, not a folder to invent. Prints the destination, size and sha256 so
// the line can go straight into docs/release-acceptance-record.md.
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FROM = join(here, '..', 'dist', 'release', 'band-coach.html');
export const DEFAULT_DIR = '/mnt/d';

export function stage({ from = DEFAULT_FROM, dir = process.env.BC_STAGE_DIR || DEFAULT_DIR } = {}) {
  if (!existsSync(from)) throw new Error(`stage: no release file at ${from} (run npm run build -- --release first)`);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`stage: target dir ${dir} is not mounted`);
  const to = join(dir, basename(from));
  // Read then write, never copyFileSync: the Windows drive mounts (/mnt/d is
  // 9p drvfs) refuse the copy_file_range path with EPERM, while a plain write
  // works. cp(1) falls back the same way; node's copyFileSync does not.
  const data = readFileSync(from);
  writeFileSync(to, data);
  const bytes = statSync(to).size;
  const sha256 = createHash('sha256').update(data).digest('hex');
  return { to, bytes, sha256 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = stage();
  console.log(`staged ${r.to} (${r.bytes} bytes, sha256 ${r.sha256})`);
}
