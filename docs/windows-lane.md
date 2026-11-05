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
  --win-root /mnt/d/band-coach-win-lane --expect-version <package.json version>
```

Pick a root your WSL user can write: the Windows profile's
`/mnt/c/Users/<you>/AppData/Local/Temp` can refuse a WSL user with `EACCES` (seen
2026-10-03), while a data drive such as `/mnt/d` worked. Without `--expect-version`, W3 ends OBSERVED and the lane exits 1.

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
| `--visible` | Place the window on the screen of its Windows session. By default it is headed but placed off-screen (`-32000,-32000`). A window started from WSL can sit in a session that is not the one on your monitor, so you may still not see it. |
| `--chrome <C:\...\chrome.exe>` | Use this Chrome. If it does not exist the lane exits 2 with "chrome not found". |
| `--node <path>` | Windows `node.exe`. Default `/mnt/c/Program Files/nodejs/node.exe`. |
| `--report <path>` | Where the JSON report goes. Default `dist/windows-lane-report.json`. |
| `--clips <path>` | Where G1 leaves its takes. Default `dist/guitar-takes`. A folder that already holds a `manifest.json` exits 2, so a second run cannot overwrite takes a person played. |

## The kit reading (K1)

What a real kit sends for one hit, read off the kit itself. A person is needed only to hit the pads:

```
node build/build.mjs --release
node tests/acceptance/win/run.mjs --win-root /mnt/d/band-coach-win-lane --only K1 --report dist/k1.json
```

Close every other copy of Band Coach first, because another program holding the port stops the kit being heard. You do not need to see or open anything: the listener runs in a Windows session that is not on your monitor and still hears the USB kit. Hit each pad once, about a second apart, then again harder or softer. It stops 3 seconds after 20 hits, or a minute after the last hit once it has 6, or after 11 minutes.

It listens on every input except `band-coach-lane` through one connection of its own, without pressing the app's Connect, so a repeat came from the kit or its driver and not from the app. It sends nothing. Note-ons less than 250 ms apart count as one hit, and the report gives every hit's notes, gaps and loudness:

| What one hit sent | Result names |
|---|---|
| One note | No guard: the cause is elsewhere |
| The same note repeated, every gap 20 ms or less (half the 40 ms flam window) | A short fixed window for all MIDI |
| The same note repeated, a gap over 20 ms | A loudness rule on kit parts, tested on this kit first |
| Different notes, or the same note on two ports | Bleed if a soft note follows a loud one by a few ms (`padBleeds`), otherwise a piece owns several notes |

The reading of 2026-11-03 found both repeats and bleed. It is kept as `tests/fixtures/midi/kit-reading-usb-midi.json` and the guard (`createHitGuard`, `src/core/midi.js`) is tested against it. A second reading that day, the kick alone played hard, found soft snare and tom notes beside the kick; it is kept as `tests/fixtures/midi/kit-reading-kick-usb-midi.json`, and `padBleeds` (`src/instruments/drum-kit.js`) is written from it.

### One pad, played hard (`--pad`, `--hits`)

To ask whether one pad sends other pads' notes, play only that pad. Run it from a checkout at current `main`, because an older one refuses `--pad` as an unknown argument. The lane needs the release file, so build it first, or pass an already staged copy with `--html <path>`:

```
node build/build.mjs --release
node tests/acceptance/win/run.mjs --win-root /mnt/d/band-coach-win-lane --only K1 --pad kick --hits 20 --report <path>
```

| Flag | What it does |
|---|---|
| `--pad <pieceId>` | A piece id from `PIECES` in `src/instruments/drum-kit.js` (`kick`, `snare`, `hihat-closed`, `hihat-pedal`, `hihat-open`, `tom-floor`, `tom-mid`, `tom-high`, `crash`, `ride`). The screen says "Hit only the Kick, 20 times, some hard and some normal. Heard k of 20." An unknown id is BLOCKED and lists the ids. |
| `--hits <n>` | How many hits to listen for (a whole number, default 20). |

Each hit is own when every note in it belongs to that piece, and crosstalk when it carries any other note. The result line reads, for example, `kick: 20 hits, 17 clean, 3 also sent 38 (snare, vel 20-31), 1 also sent 48 (tom-high, vel 18)`: of 20 kick hits, 3 also sent note 38, which the table gives to the snare, at velocities 20 to 31, and 1 also sent 48, the high tom, at 18. A note no piece owns reads `not a kit note`. All clean ends with "No crosstalk from this pad: the cause is elsewhere"; any crosstalk ends with "Crosstalk: a rule for this pad, written from these velocities". The report keeps each hit's class and the per-note counts and velocity ranges under `reading.pad`.

Every K1 reading also records the app's saved pad list, read from the page's own storage (key `bandcoach.v1`, `prefs.kit.midiMaps`), not through `window.__coach`, which the release file does not have. The text ends with `Saved pad list: none` or `Saved pad list for <device>: 38->tom-high, 48->ride`, and the report carries it as `savedPadList`. The lane opens Chrome with a fresh profile, so expect none unless the profile held a saved list.

The result is OBSERVED, or BLOCKED if no port or no note was heard, and never PASS. K1 is in `attended` in `run.mjs`, not `registry`, so a full lane run never runs it or counts it.

## The kit check (K2)

The drum-kit sheet in [hand-test.md](hand-test.md) section 2, filled in by the lane. A person only hits a pad when the terminal says to, and the sheet is copied from the line the app itself shows:

```
node tests/acceptance/win/run.mjs --win-root /mnt/d/band-coach-win-lane --html <staged file> --sha256 <its sha256> --only K2 --report <path>
```

Run it in your own terminal, because the prompts print there, with the kit on and every other copy of Band Coach closed. You do not need to see or open anything: Chrome runs in a Windows session that is not on your monitor and still hears the USB kit. It takes about 3 minutes and has four rounds, all on the release file through its own screens (Drum kit, the set-up sheet, Connect MIDI):

Every prompt names the pad and then says where it sits on a standard kit, in the words the app uses for it (the app's `kit.desc.*` lines).

| Round | What you do | What it records |
|---|---|---|
| 1 | Hit each of the 10 pads once | What the app calls each pad before it is taught. A wrong name here is what the walk-through is for, so this round never fails the check |
| 2 | The app's "Hit each pad" walk-through, in its own words | The saved pad list after it. A step with nothing heard in 40 seconds is skipped |
| 3 | Hit each of the 10 pads once again | The sheet's table |
| 4 | Hit the kick as hard as you can, 5 times | Every line must name the kick, one per hit, with the loudest velocity and what else the kick sent |

A row passes only when each hit got one line and the line names the piece hit. A wrong name, one strike read twice and a hit the app stayed quiet about each fail the row; a pad with nothing heard in 25 seconds is `not run`. Silence on the first 3 pads stops it as BLOCKED, because the kit is not reaching Chrome.

The filled sheet prints at the end and is in the report as `observed.sheetMd`, beside the notes each pad sent and the whole MIDI log. The result is PASS, FAIL, BLOCKED, or OBSERVED when a row was not run or the kick never reached velocity 127, which leaves the crosstalk rule untested. `--only` always exits 1, so read the result line, not the exit code.

What it does not cover: Chrome opens with a fresh profile, so it never sees the pad list saved in your own Chrome. If your own Chrome still names the wrong drums after this passes, press "Hit each pad" there once. It also does not play an exercise, so the correct-hit marks and beat cues in README step 7 stay with a person.

`--rehearse` sends every hit on `band-coach-lane` instead (by exact name, nothing is sent anywhere else), so an agent runs the whole check on real Chrome before a person's time is spent. A rehearsal is never a PASS and its sheet says it was no kit. K2 is in `attended` in `run.mjs`, so a full lane run never runs it or counts it.

## The guitar takes (G1)

Run it with a guitar in your hands, in your own terminal, because the prompts print there:

```
node tests/acceptance/win/run.mjs --win-root /mnt/d/band-coach-win-lane --html <staged file> --sha256 <its sha256> --only G1 --clips /mnt/d/band-coach-takes --report <path>
```

This is the one scenario that opens the machine's **real microphone**: its `attended` entry has `realMic`, which drops Chrome's fake device. It records during round 1, so run it when no one is talking nearby. It takes about 5 minutes on the release file, through its own screens (Guitar, the set-up sheet, Connect):

| Round | What you do | What it records |
|---|---|---|
| 1 | Pluck when the terminal says `PLUCK NOW`: 12 takes, covering each open string, soft, hard, the same note twice, and a silent room | One WAV per take, plus `manifest.json`. A take is redone up to 3 times if no pluck was heard, it clipped, or something sounded before the prompt. A take that stays bad is left out and named |
| 2 | Play the 8 notes the terminal relays from the app's screen, once each | What the app said about each one |

A note in round 2 passes on exactly one "yes". A wrong note, a second reply and no reply each fail it, and three notes in a row with no reply end the round. The script decides the result from the line the app shows, not a person or an agent. The filled sheet prints at the end and is in the report as `observed.sheetMd`. `--only` always exits 1, so read the result line.

BLOCKED with "pure silence" means Chrome got a mic that delivers nothing. Check that it is not muted and that Windows lets desktop apps use it. A Chrome started from WSL may also sit in a Windows session away from your monitor, and whether that session hears the mic is **not yet checked on a real run**; if it does not, start it from Windows (below).

`--rehearse` runs it all on Chrome's fake mic, so the real mic stays closed and an agent can check the flow with no one there. A rehearsal is never a PASS and writes no manifest, so its beeps cannot be committed as a guitar.

What it does not cover: the tuner (README step 4), any note past the first lesson a fresh profile gets, and whether the sound is good. It uses a fresh Chrome profile, so a mic chosen in your own Chrome is not used: it opens the Windows default input.

### Replaying the takes in CI

`tests/characterization/guitar-takes-replay.test.mjs` plays each take in `tests/fixtures/real-guitar/manifest.json` through the real worklet on Chromium's fake mic and asks for one reply per pluck, the right note, and nothing at all for the silent room. Until takes are added it runs three made-up takes that only prove the test itself. To add them:

1. **Listen to every WAV first.** Anything said nearby ends up in the repository for anyone who can read it. Redo the run if you hear talk.
2. Copy the WAVs and `manifest.json` into `tests/fixtures/real-guitar/` and open a PR. The set is about 4 MB.
3. A red take is either the wrong string played or a real bug: the failure quotes what the app said.

A replay shows the app handles what one mic once heard. It is not a real-device check, so it does not replace G1 in a release record.

### Claude on Windows

A brief for a Claude Code session on the Windows side, which can do what this WSL side cannot: see the desktop and the Windows sound settings. **Claude helps run the session. It does not decide the result, and it does not hear the audio.**

Read this section, then:

1. Find the repository: run `wsl -l -v` for the distro, then it is `\\wsl.localhost\<distro>\home\dev\workspaces\_active\app-band-coach`. Treat it as read-only. Commit nothing and push nothing.
2. Before anyone plays, check the mic can be reached: the Windows setting "Let desktop apps access your microphone" (`HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone`, `Value`) is `Allow`, and the input the person means to use is the Windows default. Tell them to set it if not. Those are settings on their machine, so change none yourself.
3. Check the flow with no one playing: from WSL, the G1 command above with `--rehearse` and a scratch `--clips` folder. It should end OBSERVED. Report anything else.
4. Hand the person the real G1 command to run in their own terminal, because a prompt that shows up late spoils the take. Do not run it for them, and do not open the mic without them.
5. If it ends BLOCKED with "pure silence", start it from Windows instead, in the desktop session. Copy `tests/helpers`, `tests/fixtures/acceptance`, `tests/acceptance/win`, `src/core/i18n.js` and `src/instruments/drum-kit.js` to `D:\band-coach-g1`, keeping their folders, then hand them `node D:\band-coach-g1\tests\acceptance\win\run.mjs --run-dir D:\band-coach-g1 --html <file> --sha256 <sha> --only G1 --report D:\band-coach-g1\report.json`. The takes land in `D:\band-coach-g1\clips`.
6. Afterwards read the report and summarize `observed.sheetMd` word for word, the result line included. A take left out goes in the summary. Never restate a FAIL as a pass or decide it was the player's mistake: say what the app said and let the person answer.
7. Leave the takes where they are. The person listens before anything is copied into the repository.

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
| 2, MIDI keyboard | none | **Not automated.** "found" to "working" needs key presses on a real keyboard. The box does have a working loopback port, `band-coach-lane` (W6 uses it), but a loopback is not a keyboard: check a real one by hand. |
| 3, microphone instrument | G1 `g1-guitar-takes.win.mjs`, by name only | Needs a person and a guitar. Real plucks on the real mic, on guitar only; other mic instruments stay with the hand test. See "The guitar takes (G1)". |
| 4, tuner | none | Not automated by this lane. |
| 5, progress survives a reload | W2 `w2-progress-reload.win.mjs` | Fresh profile. A real click on Start, then the computer-key row for the nine notes the screen asks for, then End session. What is stored (`bandcoach.v1`, reported as a length and checksum) and what is shown (the "last keyboard session" line and the progress bar) must both have changed, and both must be the same after a reload. The reload is the browser's own `Page.reload` over the DevTools connection, not the F5 key (DevTools key events do not trigger a reload). |
| 6, check for updates | W3 `w3-update-check.win.mjs` | Real clicks on Settings, then "Check for updates", with the network on. PASS needs "You're running the latest version (x.y.z)" with the version given by `--expect-version`; without it the result is OBSERVED (exit 1). "Behind", "Couldn't reach the update server", "development build" and a check still on "Checking…" after 30 s are FAIL. The offline case is **not covered**. |
| acceptance A02, sound only on a gesture | W4 `w4-audio-gesture.win.mjs` | After the load settle no AudioContext is running and no "AudioContext was not allowed to start" message exists; a real click on Start then makes exactly one run, the button says Pause, still no warning or exception. |
| acceptance A03, Connect handles the MIDI outcome (not README check 2) | W5 `w5-midi-outcome.win.mjs` | The lane answers Chrome's MIDI question with Allow (`Browser.grantPermissions`, midi and midi-sysex) and clicks Set up input, then Connect. Any outcome the app words plainly (keyboard found or working, none plugged in, another program using it) is PASS and the report names which one. An error text after the Allow, an exception, or a MIDI output picked is FAIL; a status that never changes in 30 s is BLOCKED. If the app says the answer was no, the same request is made from the page: success there makes it FAIL, a refusal there is BLOCKED (the lane could not get Chrome to honour its Allow). **No MIDI is sent**: the lane never touches the output select or "Play it for me". It needs real MIDI hardware to say anything about a found keyboard. |
| kit walk-through under real MIDI notes (not README check 2) | W6 `w6-kit-walk-through.win.mjs` | Picks Drum kit, clicks Set up input, Connect, then "Hit each pad", and sends notes ONLY on the output port named exactly `band-coach-lane`, through the page's own Web MIDI outputs; nothing is ever sent to any other port (a real `USB MIDI` kit may be attached). If that port is absent the result is BLOCKED and names it; no other port is picked. One note must advance the walk-through one pad, and so must the same note twice 15 ms apart (otherwise FAIL). The report carries pad before, pad after and pads advanced for each. |
| a real kit's extra notes on the trainer and in Songs (not README check 2) | W7 `w7-kit-double-hits.win.mjs` | Picks Drum kit, connects, and sends the strikes the real kit sent ONLY on `band-coach-lane`: one note, the same note again softer 30 ms later, a loud hi-hat with a soft snare behind it, and a full-force kick with a soft snare and tom behind it. If the port is absent the result is BLOCKED. On the trainer screen a repeat and a bleed must each add one to "Double hits ignored" in MIDI details, the kick's crosstalk two, and a single strike none; in a Rock beat drum step each strike must add one to "Notes heard so far". It does not judge a bar on the beat: the release file has no hook to time one, so that stays in `tests/characterization/kit-double-hits.test.mjs` and the hand test. |

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
