# Security Policy

## Supported versions

Band Coach is distributed as a single downloadable `band-coach.html` from this
repository's releases. Only the latest release receives security fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do **not** open a public issue
for a security report.

Open a private advisory with GitHub's **Security -> Report a vulnerability** tab on
this repository (Private Vulnerability Reporting):
<https://github.com/Back-Road-Creative/band-coach/security/advisories/new>

Please include:

- the affected version,
- a description of the issue and its impact,
- steps to reproduce it, or a proof of concept,
- any suggested fix.

## What Band Coach touches

This is what the source does today. Each point names where to check it.

- **Microphone.** The microphone is opened with `getUserMedia` (`src/app.js`) when
  you start an exercise that listens, or press "Record a take" in play-along
  (`src/ui/playalong.js`). The tracks are stopped when you leave that mode
  (`src/app.js`). A recorded take is kept only in memory for the tab; the code
  comment in `src/ui/playalong.js` says it is never sent anywhere, and the only
  network calls are the two listed below.
- **Browser storage.** Progress and settings live in `localStorage`. Your song
  library and the optional model pack live in `IndexedDB` (the library database is
  named `bandcoach-songs`, see `src/ui/editor.js`). Error notes are kept in
  `sessionStorage` for the tab (`src/app.js`). The "erase all" button clears
  these. Nothing is stored in cookies.
- **Network requests.** Band Coach makes a request only when you press a button:
  - "Check for updates" fetches
    `https://back-road-creative.github.io/band-coach/version.json`
    (`src/core/update-check.js`).
  - The optional model pack button fetches a manifest and pack from
    `https://back-road-creative.github.io/band-coach/model-packs/`
    (`src/core/model-pack.js`).

  It does not open a `WebSocket` or `XMLHttpRequest`, and the only `fetch` calls in
  `src/` are those two. Nothing is requested on load, on a timer, or in the
  background.

## Scope

In scope: the app code under `src/` and `build/`, the Windows package under
`store/`, and the release workflows under `.github/workflows/`.

Out of scope: issues in your browser or operating system, and in third-party tools
this repository only depends on.
