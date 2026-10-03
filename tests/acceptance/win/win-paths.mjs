// Path rules for the Windows lane, pure and testable on Linux. The lane runs
// from WSL, copies what it needs into a fresh run directory under a root the
// caller names, and removes only that directory. These functions are what make
// "it can only ever write or delete inside its own run directory" true: a path
// that is not a /mnt/<drive letter>/ path has no Windows form, and cleanup
// refuses anything that is not a direct run-* child of the root.
import { rmSync } from 'node:fs';
import { posix } from 'node:path';

const MNT = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/;

// '/mnt/c/a/b' -> 'C:\a\b'. A pure string map: no wslpath call, and a path with
// no Windows form (anywhere but /mnt/<letter>/, or one using "..") throws.
export function winPathOf(wslPath) {
  const m = typeof wslPath === 'string' && MNT.exec(wslPath);
  const parts = m ? (m[2] || '').split('/').filter(Boolean) : [];
  if (!m || parts.some((p) => p === '..' || p === '.' || p.includes('\\'))) {
    throw new Error(`no Windows form for ${JSON.stringify(wslPath)}: the lane only maps /mnt/<drive letter>/ paths`);
  }
  return `${m[1].toUpperCase()}:\\${parts.join('\\')}`;
}

// null when `root` is a place the lane may make run directories in, else why not.
export function checkWinRoot(root) {
  if (typeof root !== 'string' || !root) return '--win-root is required: a /mnt/<drive letter>/ folder the lane may create run directories in';
  if (/q9probe/i.test(root)) return `--win-root ${root} is the Q9 probe's folder (q9probe): the lane never works there`;
  const m = MNT.exec(root);
  if (!m || !(m[2] || '').split('/').some(Boolean)) return `--win-root ${root} must be a folder under /mnt/<drive letter>/, such as /mnt/c/Users/<you>/AppData/Local/Temp/band-coach-win-lane`;
  if (root.split('/').some((p) => p === '..' || p === '.')) return `--win-root ${root} must not contain "." or ".." parts`;
  return null;
}

// Removes `dir` only if it is a direct child of `root` named run-<something>;
// anything else throws and removes nothing. `rm` is injectable for the test.
export function cleanupRun(dir, root, { rm = rmSync } = {}) {
  const d = posix.normalize(String(dir)).replace(/\/+$/, '');
  const r = posix.normalize(String(root)).replace(/\/+$/, '');
  const dotDot = String(dir).split('/').includes('..');
  if (dotDot || posix.dirname(d) !== r || !/^run-.+/.test(posix.basename(d))) {
    throw new Error(`refusing to remove ${dir}: not a run-* directory directly inside ${root}`);
  }
  rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// The environment the Windows side sets before its first launch, so the
// driver's profile directory (os.tmpdir()) lands inside the run directory.
export function laneEnv(runDirWin) {
  if (!/^[A-Za-z]:\\/.test(String(runDirWin))) throw new Error(`laneEnv needs a Windows path (C:\\...), got ${JSON.stringify(runDirWin)}`);
  const tmp = `${runDirWin}\\tmp`;
  return { TEMP: tmp, TMP: tmp };
}
