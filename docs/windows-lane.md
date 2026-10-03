# The Windows lane

A person hand-tests the downloaded `band-coach.html` on Windows before a release
(README, "Before announcing a release: a five-minute human check"). The Windows lane
runs parts of that check in a real, headed Windows Chrome (off-screen unless `--visible`),
started from WSL, and keeps the evidence. It does not replace the hand test for what it
cannot reach (see "What it covers").

It is **outside `npm test`, `npm run gate` and CI**. Its scenario files are named
`*.win.mjs` so no test glob picks them up, and it needs a Windows machine with Chrome
and Windows `node.exe`. Only its pure decisions are tested in `npm test`
(`tests/unit/win-lane-*.test.mjs`, no browser launched).

## Run it

From the repository, inside WSL, with the release file built
(`node build/build.mjs --release`):

```
node tests/acceptance/win/run.mjs \
  --win-root /mnt/c/Users/<you>/AppData/Local/Temp/band-coach-win-lane
```

`--win-root` is required: a folder under `/mnt/<drive letter>/` where the lane may create
`run-*` directories. For each run it copies the driver, the scenarios and the release file
into a fresh `run-*` directory there, runs Windows `node.exe` on the copy, copies the
report back and removes that directory. It writes and removes nothing else. The browser
profile lives inside the run directory too.

| Flag | Meaning |
| --- | --- |
| `--html <path>` | The file to open. Default `dist/release/band-coach.html`. A Linux path is copied into the run directory and its sha256 taken for you; a Windows path (`D:\band-coach.html`) is opened in place, read-only, and needs `--sha256`. |
| `--sha256 <hex>` | The sha256 the opened file must have. A mismatch exits 2. |
| `--expect-version <v>` | The version the file should report (used by scenarios that read it). |
| `--only <id>` | Run one scenario. A partial run always exits 1. |
| `--visible` | Open the window on screen. By default it is headed but placed off-screen (`-32000,-32000`). |
| `--chrome <C:\...\chrome.exe>` | Use this Chrome. If it does not exist the lane exits 2 with "chrome not found". |
| `--node <path>` | Windows `node.exe`. Default `/mnt/c/Program Files/nodejs/node.exe`. |
| `--report <path>` | Where the JSON report goes. Default `dist/windows-lane-report.json`. |

## Results and exit codes

Each scenario ends PASS, FAIL (with the finding), OBSERVED (something was seen but not
judged) or BLOCKED (a step could not be done, named in the text). Only PASS counts.

- **0**: every registered scenario PASSED in a full run.
- **1**: something FAILED, was OBSERVED or BLOCKED, the run was partial (`--only`), or nothing ran.
- **2**: the lane could not run: bad arguments, `--win-root` missing or not under
  `/mnt/<letter>/`, no `node.exe`, Chrome not found, the file's sha256 is not the one given,
  an unknown `--only` scenario, or Chrome could not be started (the result is BLOCKED with the driver's error).

The report (JSON) holds each result with what was observed, the browser and launch flags,
the sha256 and size of the file opened, and the wall time.

## What it covers

| README check | Scenario | State |
| --- | --- | --- |
| 1, open the file (and acceptance finding 6, red console errors on a real machine) | W1 `w1-clean-open.win.mjs` | Fresh profile, extensions off, release file only: no console error or warning, no browser log entry, no exception, exactly one request (the file itself), no debug hook, and the sha256 is the one given. |
| 2, MIDI keyboard | none | **Not automated.** "found" to "working" needs key presses on a real keyboard, and the box has no virtual MIDI driver. Do it by hand. |
| 3, microphone instrument; 4, tuner | none | Not automated by this lane. |
| 5, progress survives a reload; 6, check for updates | not yet | Later change. |

A clean W1 says "not reproduced in a clean profile, extensions off". That is one clean
profile on one machine, not proof that finding 6 is fixed.

## Design notes

- Windows `node.exe` is started with a script copied under the Windows filesystem, not a
  `\\wsl.localhost\...` path, and gets every option by argument (no environment passing).
- Real input only: scenarios click and press keys through the driver and only read the page
  with `evaluate`. They never use `window.__coach` (the release file has none; the driver
  refuses a file that does).
- One browser launch per scenario. Closing a launch ends the Chrome process tree
  (`taskkill /T /F`); on the first real Windows runs the profile folder was still there after `close()`, so it
  is removed with the run directory instead, which the lane does after every run.
