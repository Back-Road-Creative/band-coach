# The Windows lane

A person hand-tests the downloaded `band-coach.html` on Windows before a release
(README, "Before announcing a release: a five-minute human check"). The Windows lane
runs parts of that check in a real, headed Windows Chrome (off-screen unless `--visible`),
started from WSL, and keeps the evidence. It does not replace the hand test for what it
cannot reach (see "What it covers").

It is **outside `npm test`, `npm run gate` and CI**. Its scenario files are named
`*.win.mjs` so no test glob picks them up, and it needs a Windows machine with Chrome
and Windows `node.exe`. Only its pure decisions are tested in `npm test`
(`tests/unit/win-lane-*.test.mjs`, no browser launched). One of them (the stand-in `node.exe` test for the missing-report rule) writes under a Windows
directory, so it runs only when `BAND_COACH_WIN_TEST_ROOT` names one, for example
`/mnt/c/Users/<you>/AppData/Local/Temp/band-coach-win-lane/unit`; otherwise it is skipped with that reason.

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

A product that does not answer a real click is FAIL, not BLOCKED: W3, W4 and W5 record a timed-out
step after a click (Settings never showing "Check for updates", no sound after Start, a button that
never says Pause, no Set up input sheet) in the observation and read the page anyway, so the verdict
names the finding. BLOCKED is kept for what the lane itself could not do (Chrome would not start, or
refused its MIDI Allow, or the exercise asked for something W2 has no key for).

- **0**: every registered scenario PASSED in a full run.
- **1**: something FAILED, was OBSERVED or BLOCKED, the run was partial (`--only`), or nothing ran.
- **2**: the lane could not run: bad arguments, `--win-root` missing or not under
  `/mnt/<letter>/`, no `node.exe`, Chrome not found, the file's sha256 is not the one given,
  an unknown `--only` scenario, Chrome could not be started (the result is BLOCKED with the driver's error),
  or the Windows side wrote no report at all. The last one is exit 2 whatever exit status `node.exe` gave:
  a WSL interop failure (for example `UtilAcceptVsock: accept4 failed 110`) can make `node.exe` exit 1 having
  run nothing, and that must not read as a scenario result. Run it again; the written report says
  "the Windows side wrote no report".

The report (JSON) holds each result with what was observed, the browser and launch flags,
the sha256 and size of the file opened, and the wall time.

## What it covers

| README check | Scenario | State |
| --- | --- | --- |
| 1, open the file (and acceptance finding 6, red console errors on a real machine) | W1 `w1-clean-open.win.mjs` | Fresh profile, extensions off, release file only: no console error or warning, no browser log entry, no exception, exactly one request (the file itself), no debug hook, and the sha256 is the one given. |
| 2, MIDI keyboard | none | **Not automated.** "found" to "working" needs key presses on a real keyboard, and the box has no virtual MIDI driver. Do it by hand. |
| 3, microphone instrument; 4, tuner | none | Not automated by this lane. |
| 5, progress survives a reload | W2 `w2-progress-reload.win.mjs` | Fresh profile. A real click on Start, then the computer-key row for the nine notes the screen asks for, then End session. What is stored (`bandcoach.v1`, reported as a length and checksum) and what is shown (the "last keyboard session" line and the progress bar) must both have changed, and both must be the same after a reload. The reload is the browser's own `Page.reload` over the DevTools connection, not the F5 key (DevTools key events do not trigger a reload). |
| 6, check for updates | W3 `w3-update-check.win.mjs` | Real clicks on Settings, then "Check for updates", with the network on. PASS needs "You're running the latest version (x.y.z)" with the version given by `--expect-version`; without it the result is OBSERVED (exit 1). "Behind", "Couldn't reach the update server", "development build" and a check still on "Checking…" after 30 s are FAIL. The offline case is **not covered**. |
| acceptance A02, sound only on a gesture | W4 `w4-audio-gesture.win.mjs` | After the load settle no AudioContext is running and no "AudioContext was not allowed to start" message exists; a real click on Start then makes exactly one run, the button says Pause, still no warning or exception. |
| acceptance A03, Connect handles the MIDI outcome (not README check 2) | W5 `w5-midi-outcome.win.mjs` | The lane answers Chrome's MIDI question with Allow (`Browser.grantPermissions`, midi and midi-sysex) and clicks Set up input, then Connect. Any outcome the app words plainly (keyboard found or working, none plugged in, another program using it) is PASS and the report names which one. An error text after the Allow, an exception, or a MIDI output picked is FAIL; a status that never changes in 30 s is BLOCKED. If the app says the answer was no, the same request is made from the page: success there makes it FAIL, a refusal there is BLOCKED (the lane could not get Chrome to honour its Allow). **No MIDI is sent**: the lane never touches the output select or "Play it for me". It needs real MIDI hardware to say anything about a found keyboard. |

A clean W1 says "not reproduced in a clean profile, extensions off". That is one clean
profile on one machine, not proof that finding 6 is fixed.

## Design notes

- Windows `node.exe` is started with a script copied under the Windows filesystem, not a
  `\\wsl.localhost\...` path, and gets every option by argument (no environment passing).
- Real input only: scenarios click and press keys through the driver and only read the page
  with `evaluate`. They never use `window.__coach` (the release file has none; the driver
  refuses a file that does).
- The scenarios read the app's own update messages from `src/core/i18n.js` instead of copying them, so the
  lane copies that one file into the run directory too.
- One browser launch per scenario. Closing a launch ends the Chrome process tree
  (`taskkill /T /F`); on the first real Windows runs the profile folder was still there after `close()`, so it
  is removed with the run directory instead, which the lane does after every run.
