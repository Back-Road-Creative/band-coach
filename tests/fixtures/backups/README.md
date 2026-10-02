# Backup files, frozen

Real progress-backup files kept on disk, so a change to the backup format cannot quietly stop old backups from importing. Do not regenerate or edit these to make a test pass; a failing test here means a learner's old backup would no longer restore.

- `v2-snapshot.json`: a snapshot of the current format (formatVersion 2), made once with `exportProgress` from a small hand-built db at the commit that added this folder, then frozen. Three sessions, two events, one saved user song, `prefs.noiseFloor: null`.
- `v1-backup.json`: the first backup format (formatVersion 1: no `songs` field), written the way the commit that introduced the backup file, 58c758a, wrote it (`exportProgress` and `sanitizeDB` in `git show 58c758a:src/core/progress-file.js` and `:src/app.js`). appVersion `0.1.0` is that commit's app version.
- `truncated.json`: the v2 snapshot cut off in the middle of a session record (a download that stopped early). Must be refused.
- `future-v3.json`: the v2 snapshot claiming formatVersion 3, as if made by a newer Band Coach. Must be refused.

The tests are in `tests/unit/golden-backups.test.mjs`. They do not check calibration prefs (latency, noise floor handling), which are changing separately.
