# Band Coach — Windows Store edition

A thin Electron desktop shell around the exact same one-file app the browser build ships
(`../dist/band-coach.html` or `../dist/release/band-coach.html`). Nothing here changes the app —
`src/`, `build/` and the root `package.json` are untouched. This folder has its own
`package.json` so `electron` and `electron-builder` never become dependencies of the app itself.

The Microsoft Store re-signs whatever `.msix`/`.appx` you submit, for free. So this shell is built
**unsigned** here and signed by the Store when you upload it — no paid code-signing certificate,
no paid CI, no paid services anywhere in this path.

## What's here

- `main.js` — one `BrowserWindow` loading the bundled app via `loadFile`. Single-instance lock.
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Denies all navigation and
  `window.open` away from the app file. Blocks every network request (`session.webRequest`) —
  only `file:`/`blob:`/`data:` are allowed, so the app stays visibly offline. Permission handler
  grants only `media` (microphone) and `midi`/`midiSysex`, denies everything else. Menu: Quit,
  Reload, Toggle Full Screen, About.
- `preload.js` — empty on purpose; nothing is exposed via `contextBridge`.
- `electron-builder.json` — the `appx` packaging config. Identity fields
  (`identityName`/`publisher`/`publisherDisplayName`) are **safe placeholders**
  (`PLACEHOLDER.BandCoach` / `CN=PLACEHOLDER` / `PLACEHOLDER PUBLISHER`); real values come from
  environment variables (below), never hard-coded here.
- `scripts/prepare-app.mjs` — stages the built app into `store/app/band-coach.html`, preferring
  `../dist/release/band-coach.html` and falling back to `../dist/band-coach.html`.
- `scripts/apply-identity.mjs` — overlays `BC_IDENTITY_NAME` / `BC_PUBLISHER` /
  `BC_PUBLISHER_DISPLAY_NAME` from the environment onto the placeholder config, writing
  `electron-builder.generated.json` (gitignored). electron-builder's AppX target does **not**
  expand `${env.X}` macros in these fields itself (verified against
  `node_modules/app-builder-lib/out/targets/AppxTarget.js` — it copies `appx.*` straight out of
  the resolved config with no substitution, unlike artifact-name patterns), so this script does
  the substitution before electron-builder ever reads the config.
- `scripts/generate-icons.mjs` — writes placeholder Store logo PNGs with a hand-rolled PNG
  encoder (`node:zlib` only, no image library) into `build-resources/appx/`. **Replace these with
  real branded art before submitting to the Store.** Required sizes generated:
  - `StoreLogo.png` — 50×50
  - `Square44x44Logo.png` — 44×44
  - `Square150x150Logo.png` — 150×150
  - `Wide310x150Logo.png` — 310×150

  electron-builder falls back to generic Electron sample art for these four if nothing is
  provided, so they're the ones that matter for a real submission. Optional slots the Store
  accepts but electron-builder does not require (add your own art to `build-resources/appx/` at
  these sizes if you want them): `Square71x71Logo.png` (71×71), `Square310x310Logo.png`
  (310×310), `SplashScreen.png` (620×300), `BadgeLogo.png` (24×24).

## Capabilities — what was checked, and what's NOT declared

`electron-builder.json`'s `appx.capabilities` is `["microphone"]` only. Verified against
`node_modules/app-builder-lib/out/targets/AppxCapabilities.js` and `AppxTarget.js`:

- `internetClient` is **not** declared, and electron-builder never adds it automatically — it
  only appears if you list it in `appx.capabilities`. Since we don't, the manifest ships with no
  network capability at all, matching "must visibly not phone home."
- `runFullTrust` is added by electron-builder **unconditionally** for every AppX target
  (`capSet.add("runFullTrust")` in `AppxTarget.js`) — this is required for any Electron-based
  desktop-bridge app and isn't something this config can remove.
- There is **no MIDI capability in electron-builder's AppX capability list at all** — its
  `CAPABILITY_MAP` (device/uap/uap6/uap7/common/mobile/rescap) has no `midi` entry of any kind.
  Chromium's Web MIDI implementation talks to the system MIDI service directly and isn't gated by
  a UWP/AppX capability declaration the way the microphone is, so there's nothing to add here —
  MIDI access should work in the packaged app without a manifest capability, but this has **not**
  been verified on an actual Windows machine (see "Not verified" below).

## Progress persistence

No extra plumbing: the app already keeps its own progress in `localStorage`. Electron gives the
loaded `file://` page's `localStorage` a real, private profile directory under Electron's
`userData` path, so progress now survives across launches on a real per-app location instead of a
browser profile — nothing in the app code needed to change for this.

## Getting the real identity values (Partner Center)

1. In [Partner Center](https://partner.microsoft.com/dashboard), open your app's listing, then
   **Product management → Product identity**.
2. Copy three values: **Package/Identity/Name**, **Package/Identity/Publisher**, and
   **PublisherDisplayName**.
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions → Variables** and add
   them as repository variables named exactly `BC_IDENTITY_NAME`, `BC_PUBLISHER`,
   `BC_PUBLISHER_DISPLAY_NAME`. (These are public manifest values, not secrets — that's why they're
   repository *variables*, not secrets.)
4. Run the `store-package` workflow (**Actions → store-package → Run workflow**), or push a
   `v*` tag.
5. Download the `band-coach-appx` artifact from the finished run.
6. In Partner Center, upload that `.appx` under **Packages** on your submission. The Store
   re-signs it — no local signing step, no certificate to buy.

## What was NOT verified here

- **The package has never been built.** This Linux box cannot run `electron-builder --win appx`
  (it needs `makeappx.exe`/`makepri.exe` from the Windows SDK). The first real proof this all
  works is the first `store-package` workflow run on `windows-latest`.
- **The package has never been installed or launched**, so the window, menu, permission prompts
  and network block have only been checked by reading `main.js`'s source
  (`tests/unit/store-shell.test.mjs` at the repo root) — never by running the packaged app.
- **The Windows App Certification Kit has not been run.** Partner Center requires (or strongly
  recommends) passing the WACK before submission; that has to be run on a real Windows machine,
  not in this CI job.
- MIDI device access in the packaged app is unverified for the reason above (no Windows machine
  available here).
