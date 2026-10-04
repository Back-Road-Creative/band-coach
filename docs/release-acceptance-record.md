# Release acceptance record

A PR merge is an engineering hand-off. This record is the professional-readiness gate the
plan asks for (E12): one page per release candidate that names exactly what was built, what
was checked by a machine, what was checked by a person, and what is still open. Nothing here
is a claim that the app is ready; a blank "Reviewer" line means nobody has signed it.

Copy the latest record to a new section for each candidate rather than editing the old one. A
later content or code change gets its own record; it never inherits an earlier sign-off.

## How to fill one in

1. **Commit and artifact.** `git rev-parse HEAD` for the commit; `npm run build -- --release`
   then `sha256sum dist/release/band-coach.html` and `stat -c %s` for the file. A locally
   built file is evidence that the build is reproducible, not the thing a learner downloads:
   once the tag's release exists, download the attached `band-coach.html` and record that hash
   too. The Pages and Store editions wrap the same file (README "Phone copy", "Windows Store
   edition"); `tests/build/pages.test.mjs` proves the release file is byte-identical with or
   without the Pages build.
2. **Scope.** Copy the platform, input and content lines from README "Browser and device
   support" and "Beginner pathway status" as they stand at the commit. Do not widen them.
3. **Automated checks.** The CI `test` check on the commit (`npm test`, which runs the full
   suite and then the release gate). Record the pass line from the CI log or a local run.
4. **Manual runs.** README "Before announcing a release: a five-minute human check", step by
   step, on the release build the candidate's "Candidate artifact" row names (its staged copy
   before a release, the downloaded file after one), naming the machine, browser version and
   hardware. Then the
   D2/E9 ledger below: each "human on device" cell is filled in by the person who did it, with
   the device model, or left as **open**. A step the README marks as covered by the Windows lane
   ([windows-lane.md](windows-lane.md)) is skipped by hand only when the candidate's "Windows
   lane" row names a passing run on the same sha256 as the candidate artifact: the lane's JSON
   report, the sha256 it checked, and each scenario's verdict.
5. **Reviewer and date.** The person signing, and when. An unsigned record is a draft.

## Candidate: main after the September 2026 refactor waves

| Field | Value |
|---|---|
| Commit | `2f37dec` (`origin/main`, 2026-09-30 11:05 PM EDT, after #367, the last of the September refactor units C1 to C12 and the comment-citation chore #366). |
| Last published release | v1.9.0, tag commit `b029dc1`, asset `band-coach.html` sha256 `05d267982c3ed7140fb862280cfa21c44c6ac0ae630ea9615d1a54f4171a085b`, 483,093 bytes (downloaded from the GitHub release 2026-09-30). |
| Candidate artifact | Local `npm run build -- --release` at `2f37dec`: `dist/release/band-coach.html` sha256 `14e3da0346fefe61977954d74ffecaf55e3af571ceb8aed631be4d8d5031fcfa`, 631,021 bytes (reproducibility evidence only; no tag or GitHub release exists for this commit). 162 commits on `main` since v1.9.0. |
| Platforms | As README "Browser and device support": headless Chromium through the automated suite only. Windowed Chrome/Edge, Firefox, Safari, iPhone/iPad and every real MIDI keyboard, e-kit or microphone instrument are untested for this candidate. |
| Inputs | MIDI (Web MIDI), computer keys, on-screen keys and taps, microphone. Only the keyboard pathway's independent check requires MIDI; mic and audio pathways have no precision, recall or abstention profile (plan residual E4). |
| Content | Every teaching text in the keyboard pathway still reads "Not yet checked by a player" (README "Beginner pathway status"); the review ledger `src/instruments/review-ledger.js` is empty. No reviewed corpus or content revision exists to cite. |
| Dependencies | Node 22 (`engines`: `>=22`; CI `actions/setup-node@v4` with `node-version: 22`; local v22.22.2). Dev: esbuild 0.28.2, axe-core 4.13.0. No runtime dependency: the shipped file carries nothing from `node_modules`. Browser under test: CI uses the runner image's `google-chrome` (`CHROME_BIN`, not pinned; the job log names its version); locally Chromium 153.0.8010.47. |
| Automated checks | CI `test` check green on the #367 head (run 36807121762); the `main` run on `2f37dec` is 36808862671. Full local suite on the #367 head rebased onto #365/#366 (`npm test --ignore-scripts=false`): `# tests 3050 # pass 3050 # fail 0`. Release gate `tests/release/gate.test.mjs`: 7 tests, including the 1.5 MB size budget, zero network, zero console errors, debug hook removed, version stamped, tuner decay, a real MIDI note-on through Connect, and a real key press with no debug hook. |
| Manual runs | **None for this candidate.** The five-minute human check has not been run on a build of this commit. |
| Unresolved limitations | The plan residuals listed under "Plan-unit residuals" in the comprehensive plan (B1, B2, B3, C1, C11, E1, E2, E4, E5, E6, E7) all still hold. iPhone microphone behaviour unmeasured. Firefox and Safari fallbacks unconfirmed by hand. No performance budget (E10) has been measured on real hardware. Rollback: a bad release is withdrawn by deleting the GitHub release and re-tagging; that rehearsal has not been done. |
| Reviewer / date | _unsigned_ |

## Candidate: `e4b6fb5` hand-tested 2026-10-01 -- NOT READY

| Field | Value |
|---|---|
| Commit | `e4b6fb5` (`origin/main`, 2026-10-01, after #368). |
| Candidate artifact | `npm run build -- --release` at `e4b6fb5`: `dist/release/band-coach.html` sha256 `14e3da0346fefe61977954d74ffecaf55e3af571ceb8aed631be4d8d5031fcfa`, 631,021 bytes, copied to `D:\band-coach.html` for the hand run. No tag or GitHub release for this commit. |
| Manual runs | One, by JP, 2026-10-01 evening EDT, windowed Chrome on Windows opening `D:\band-coach.html` from `file://`, with a real microphone and a MIDI keyboard that connected under v1.9.0. Verdict from the tester: not ready to release. |
| Automated checks | CI `test` green on `e4b6fb5`. The automated suite did not catch any of the findings below: it launches Chromium with `--autoplay-policy=no-user-gesture-required`, grants mic and MIDI without a prompt, and feeds a synthetic signal well above the default gate. |
| Findings (reproduced headless unless marked) | 1. Two "The AudioContext was not allowed to start" warnings on load and on tab return (`visibilitychange` and `pageshow` handlers called `ensureAudio()`, which creates the context without a gesture). Reproduced with the harness autoplay flag removed; fix: PR "never create the AudioContext from a tab return". 2. MIDI did not connect: Chrome 124+ shows a permission prompt for Web MIDI; a declined or dismissed prompt rejected with `NotAllowedError` and the app showed "MIDI was blocked here", the text written for the `SecurityError` case, with no way to ask again. Reproduced with the prompt denied; fix: PR "say what Chrome asked for when MIDI is refused". 3. Guitar through the microphone was judged almost never: a quiet pluck (attack RMS about 0.009, ring about 0.004) fell under the default `note` gate 0.01 and the diagnosis called an attack-peak signal "unclear" before "too quiet". Reproduced with a recorded pluck through the fake mic; fix: PR "gate at the room's own floor". 4. Drum kit drawn in a 16:8.2 canvas with ten unlabeled symbols; a beginner cannot tell which is which. Confirmed by screenshot; fix: PR "draw the kit full height with the piece names". 5. On-screen keyboard is one octave (MIDI 48 to 72) at every level, so two-handed playing is impossible on screen; fix: PR "two octaves with hand zones from level 1". 6. "Unsafe attempt to load URL file:///D:/band-coach.html from frame with URL file:///D:/band-coach.html" in the console: **not reproduced** in the headless shell or in full Chromium 153 (`--headless=new`, file://, mic and MIDI granted, Connect/Start on keyboard, guitar and drum kit, every tab and tool clicked, update check run). The release HTML has no `<link>`, no external script, no empty `src`/`href`, no `url()`, no `fetch`, no `import()`; the worklet module is a `data:` URL. The line is attributed to `band-coach.html:1`, i.e. a document-level request, not app code: on a file:// page that is what an extension or a browser feature reading the page itself produces. Open as a question for JP: does it recur in a guest/incognito window with extensions off? If not, it is not the app's. 7. A fresh profile's first Start says "Today: nothing new due -- free practice", which reads as an empty app. Fix: PR #376 (`fix/first-visit-coach-line`) -- a learner with no item record at the level is told it is their first sitting and to play what the screen asks. |
| Mic and MIDI together | They are independent inputs. MIDI is the keyboard pathway's proof source; the microphone judges guitar, bass and voice. Nothing uses both at once. |
| Reviewer / date | JP, 2026-10-01, hand run; record written by the session that reproduced the findings. **Not accepted.** Re-run the five-minute check on a build that carries the five fix PRs above before any tag. |

## Correction, 2026-10-03: four statements in the `e4b6fb5` record

The `e4b6fb5` section above is kept as it stood at `4f0f210`. Four statements in it are wrong:

- **Finding 5's range.** It says the on-screen keyboard "is one octave (MIDI 48 to 72) at every
  level". At `e4b6fb5` the keyboard drew MIDI 60 to 72, one octave, unless the level's notes went
  below middle C (MIDI 60) or "Practise my captured melody" was on; then it drew MIDI 48 to 72,
  which is two octaves (`kbdRange`, `src/app.js:1764` at `e4b6fb5`). The fix, #374 (`c1e6eb7`),
  always draws MIDI 48 to 72 (`src/app.js:1778` at `4f0f210`).
- **Finding 5's PR title.** It quotes the fix as "two octaves with hand zones from level 1". The
  merged title of #374 (`c1e6eb7`) is "draw two octaves with left- and right-hand zones from
  level 1".
- **Finding 4's PR.** It names a PR "draw the kit full height with the piece names". The PR that
  fixed it is #375 (`1c3bca3`), "draw the kit full width with named pieces and key badges".
- **"The five fix PRs above".** There are six: #372, #373, #371, #375 and #374 fix findings 1 to
  5, and #376 fixes finding 7. Finding 6 has no fix PR: it did not reproduce in full Chromium
  (#377).

## Candidate: `09f7c35` integrated readiness candidate, 2026-10-03

| Field | Value |
|---|---|
| Commit | `09f7c35` (main after the wave-2 PRs #378 to #409 merged; the suite ran on the same tree plus #408's one test file, src, build and package files identical). |
| Last published release | `v1.9.0`, tagged 2026-09-24; this candidate is not tagged yet |
| Candidate artifact | `npm run build -- --release` at `09f7c35`: `dist/release/band-coach.html` sha256 `3f5b88175da1a70858aa64d9ef31ae78c936d3ea69239a1bb29449201484a234`, 639,584 bytes, copied to `D:\band-coach.html` for the hand run. Two release builds (the tested tree and this commit) gave the same bytes. Pages and the Store package wrap this same file. |
| Platforms | As README 'Browser and device support': headless Chromium in CI on every commit; windowed Chrome on Windows only through the Windows lane below and the hand check; Firefox and Safari untested; phone sizes emulated only, real phones untested. |
| Inputs | As README 'Browser and device support': computer keys, on-screen keys, a stubbed MIDI keyboard and a fake microphone in CI; real MIDI keyboards, e-kits and instruments through a real microphone are untested beyond the hardware of the last hand run. |
| Content | As README 'Beginner pathway status': every instrument is ready with a curriculum; every row's content review is provisional (no reviewer yet); keyed-woodwind, recorder, whistle and drum-kit charts are unchecked. |
| Dependencies | npm ci clean; npm audit found 0 vulnerabilities (.data/worktrees/bc-logs/finale/ci.log, .data/worktrees/bc-logs/finale/audit.log) |
| Automated checks | npm test: 3410 tests, 3409 pass, 0 fail, 1 skipped (.data/worktrees/bc-logs/finale/test.log). npm run gate: 192 tests, 186 pass, 0 fail, 6 todo (.data/worktrees/bc-logs/finale/gate.log). Both on tree 4790ec7, which is this commit plus #408's test file. |
| Windows lane | Report `.data/worktrees/bc-logs/finale/winlane.json`, sha256 `3f5b88175da1a70858aa64d9ef31ae78c936d3ea69239a1bb29449201484a234`: W1 PASS, W2 PASS, W3 PASS, W4 PASS, W5 PASS. |
| Manual runs | **Pending.** README "Before announcing a release: a five-minute human check", steps 2, 3, 4 and 7, on `D:\band-coach.html`, naming the machine, browser version and hardware, and the time the whole check took. Step 6 is covered by the Windows lane row above; its version line, and step 8 (the phone copy), are checked by hand once the release tag has deployed, naming the Pages URL and the sha256 of the `band-coach.html` it serves. |
| Unresolved limitations | Step time estimates are untimed. The lane's W5 used one USB MIDI interface and does not cover README check 2 (notes from a real keyboard). The offline update check is not covered. In local runs at a load average above 20, the tab-hide step of acceptance-mic-setup (T6, T7b) has timed out; open. |
| Reviewer / date | _unsigned_ |

### Findings from the `e4b6fb5` hand run: fix and retest

| Finding | Fix | Retest at `09f7c35` |
|---|---|---|
| 1 | #372 (`6ed2a38`), never create the AudioContext from a tab return or bfcache restore | PASS: `acceptance-audio-gesture` (its header names finding 1), npm run gate at the commit |
| 2 | #373 (`9b8a101`), say what Chrome asked for when MIDI is refused, and let the learner retry | PASS: `midi-denied-retry` (added by #373) and `acceptance-midi`, npm test and gate at the commit |
| 3 | #371 (`5616661`), gate at the room's own floor so a quiet guitar is judged, not called a chord | PASS: `input-diagnosis`, `levels` and `mic-device` (changed by #371) and `acceptance-live-capture`, npm test and gate at the commit |
| 4 | #375 (`1c3bca3`), draw the kit full width with named pieces and key badges | PASS: `drum-kit-draw` and `computed-instruments-drum-kit` (added or changed by #375), npm test at the commit |
| 5 | #374 (`c1e6eb7`), draw two octaves with left- and right-hand zones from level 1 | PASS: `kbd-two-octaves` (added by #374), npm test at the commit |
| 6 | None: not reproduced in full Chromium (#377) | PASS: Windows lane W1 in a clean profile, extensions off, no console error or warning (report in the Windows lane row) |
| 7 | #376 (`eb3d78e`), a fresh profile's first session is invited to play, not told nothing is due | PASS: `session-plan-coach-line` and `curriculum` (added to by #376) and `acceptance-first-visit`, npm test and gate at the commit |

## D2 / E9 evidence ledger

What the automated suite proves for each interaction, device and accessibility dimension, and
what still needs a person on a real device. "Automated" names the test files that pin the
behaviour in headless Chromium at `2f37dec`; it is never a claim about a real phone,
screen reader or browser. An axe pass is not a "screen-reader-clean" claim.

### D2 interaction and device matrix

| Dimension | Automated (headless Chromium) | Human on device |
|---|---|---|
| 320 px phone width | `nav-readable-widths` (names at 320, no ellipsis, `#playBtn` in the first screen at 320x844); `journey-first-visit`, `visual-polish-r10` set 320/390 viewports | **open** |
| 390 px phone width | `nav-readable-widths`, `songs-lesson-first`, `phone-objective-beside-start`, `kbd-focus-overview` (level-13 white keys clear the 40 px tap floor at the phone viewport); `withViewports` phone pass (390x844, touch) | **open**: touch-target size on the real Android phone (plan residual B2) |
| Tablet and desktop | `withViewports` passes at 768x1024 (touch) and 1280x800 (mouse) in `nav-readable-widths` and `songs-lesson-first` | **open** |
| Landscape | No test sets a landscape viewport. | **open** |
| Text enlargement | `withViewports` "phone-200%-text" pass (document zoom 200% at phone width) in `nav-readable-widths` and `songs-lesson-first`; `narrow-zoom-no-sideways-scroll` (real 195 and 240 px layouts, the width 200% page zoom gives a 390 px phone: no sideways scroll). There is no user-selected zoom in the app (plan residual B2). | **open**: browser or OS text scaling on a real device |
| Both themes | `theme-toggle` (Light sets `data-theme`, survives reload, stage text readable in both, Dark then System clears it); `theme-contrast`, `badge-contrast`, `stage-contrast` (unit, computed ratios); `theme-pref-sanitize` | **open** |
| Keyboard-only | `a11y-dialog-focus` (Tab trapped in the break card, wraps both ends), `a11y-panel-escape` (Escape closes a panel and returns focus to its nav button), `a11y-setup-sheet-focus`, `a11y-focus-restore`, `journey-songs` (Tab through the Songs panel) | **open**: a full journey from set-up to backup with no pointer |
| Real assistive technology | None. `a11y-axe` runs axe-core 4.13.0 with wcag2a, wcag2aa, wcag21a, wcag21aa and wcag22aa tags across the app's main states; `a11y-describe` checks the canvas role, label and description target, the polite live region, and that the description never leaks an unrevealed note name. | **open**: NVDA or VoiceOver through a lesson |
| Held, crossing and simultaneous notes | `note-state` (port, channel and pitch held set), `kbd-hands-together`, `hands-together`, `hands-together-gate`, `hands-together-stages`, `hands-together-timed`, `practice-chord-judge`, `chords`, `audio-analysis-chords` | **open**: a real MIDI keyboard; MIDI latency not measured (plan residual E4) |
| Mixed drum set-ups | `drum-kit-trainer`, `drum-kit-mic`, `drum-kit-curriculum`, `computed-instruments-drum-kit`; both drum "mic + MIDI" fallback branches in the Connect handler have no direct test (noted in the C12 PR) | **open**: a real e-kit (E4a finding 4, E4b finding 1) |
| Critical flows | `journey-first-visit`, `journey-songs`, `kbd-journey-scenarios` (four keyboard journeys, R2), `restore-staging`, `restore-preserves-latency`, `persistence`, `songs-resume`, release gate | **open**: README five-minute check on the downloaded file |

### E9 accessibility

| Requirement | Automated (headless Chromium) | Human on device |
|---|---|---|
| Text contrast | `theme-contrast`, `badge-contrast`, `stage-contrast` compute ratios from the stylesheet; `theme-toggle` checks the computed stage colour in both themes; axe colour-contrast rule | **open** |
| Keyboard access | See D2 "Keyboard-only" | **open** |
| Reflow and text resizing | See D2 "320 px", "Tablet and desktop", "Text enlargement" | **open** |
| Focus visibility and non-obscuration | `src/styles.css` has one `:focus-visible` rule; no test asserts a visible focus ring or that focus is never hidden under a fixed bar. | **open** |
| Focus return after dialogs and panels | `a11y-dialog-focus`, `a11y-panel-escape`, `a11y-focus-restore`, `a11y-setup-sheet-focus` | **open** |
| Alternatives to dragging | Only `src/ui/playalong.js` listens for pointer moves; no test asserts a non-drag path for it. | **open** |
| Target size (24x24 AA; 44x44 product goal) | axe wcag22aa target-size rule; `kbd-focus-overview` 40 px floor for level-13 keys at phone width | **open**: real phone (B2) |
| Canvas companion descriptions | `a11y-describe` (role, label, hidden description matches `describeTask()`, revealed sentence on a fail); live region is polite, so frame-by-frame note updates do not flood a reader | **open**: screen-reader walk-through of a task |
| Stop and pause while playing | `a11y-wake-lock` (wake lock requested on start, released on end), `songs-switch-stops-recording`, `browser-exit-cleanup`, `session-teardown`, `playalong-teardown` | **open** |
| Colour-independent marks | `a11y-reduced-motion` (a wrong note flashes a non-colour glyph by default) | **open** |
| Reduced motion | `a11y-reduced-motion` (with `prefers-reduced-motion`, the canvas flash and glyph are skipped) | **open** |
| Readable note and finger labels | `w-fingerings`, `w-fingerings-how`, step-view and tab-view tests pin the text | **open** |
| Captioned or described demonstrations | "Play it" demonstrations are audio only; no caption or text description is rendered and no test asks for one. | **open**: product decision as well as evidence |
| Honest construct for hearing and timed tasks | `docs/capabilities.md` maturity matrix; `assessed` tests pin which dimensions a step assesses; ear and theory adapters record no input (plan residual E5) | **open** |
| Independent set-up, lesson, transport, help, results, backup | `journey-first-visit`, `kbd-journey-scenarios`, `learn-handoffs`, `songs-how-inline`, `w-history-print`, `restore-*` cover each step with a pointer or the debug hook | **open**: keyboard-only and screen-reader users end to end |

### Release-blocking accessibility failures

None recorded, because no manual pass has been done. The axe suite passes at `2f37dec`.
A failure found by a manual pass is filed as an issue, fixed through a PR with a test, and this
table's row is updated with the PR number.
