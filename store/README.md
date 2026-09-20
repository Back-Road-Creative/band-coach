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
  grants only `media` (microphone) and `midi`/`midiSysex`, denies everything else — see
  "Permission decision" below. Menu: Quit, Reload, Toggle Full Screen, About.
- `lib/permission-policy.js` — the pure allow/deny decision for `getUserMedia`/Web MIDI requests
  (no Electron import; see "Permission decision" below).
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
  the substitution before electron-builder ever reads the config. With `--require-identity` (or
  `BC_REQUIRE_IDENTITY=1`), it refuses (non-zero exit, naming the missing env vars) to write a
  config that still has any placeholder field — see "Building a Store submission package" below.
  It also stamps the manifest's version — see "Where the appx version comes from" below.
- `scripts/generate-icons.mjs` — draws the Store logo PNGs with a hand-rolled PNG encoder
  (`node:zlib` only, no image library) into `build-resources/appx/`. The mark is a five-bar level
  meter in the app's own palette: bars on the `#1c1c1c` the tile already declares as its
  `BackgroundColor`, centre bar in the `#5be08a` the tuner uses for "in tune". Rerun it with
  `npm run generate-icons` after changing the drawing; the output is committed.

  These were solid `#2563EB` rectangles until 2026-09-20 — one distinct pixel value per file —
  and shipped that way into a real package, because a flat PNG is a valid PNG and nothing checked.
  `tests/unit/store-icons.test.mjs` now fails if any slot is a single flat colour, is effectively
  empty or solid, is the wrong size, or if the 44×44 mark smears into fewer than five bars. It
  checks the committed files and the generator separately, so hand-drawn replacements are fine —
  swap the PNGs in and the same gate still holds them to being real images. Required sizes:
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

## Where the appx version comes from

The manifest's `Identity/@Version` is **never** `store/package.json`'s own `"version"` field —
that's the Electron shell's private version, nobody ever bumps it, and for a long time every
`store-package` run silently stamped every appx `0.1.0.0` forever. The Microsoft Store accepts one
submission per version and rejects every later one at the same version as a duplicate, so that bug
meant the *second* real release ever uploaded would have failed with no test catching it.

The version stamped on the appx is now derived from the repo-root `package.json`'s own
`"version"` — the same version that's about to be released as the browser build — via
`apply-identity.mjs`, which sets `config.extraMetadata.version` in the generated config. That field
is not decorative: electron-builder deep-merges `config.extraMetadata` onto the packaged app's
`package.json` metadata before building its internal `AppInfo`
(`node_modules/app-builder-lib/out/packager.js:277`,
`deepAssign(this._metadata, configuration.extraMetadata)`), and `AppInfo`'s `version` field is what
`AppxTarget.js`'s `"version"` macro case reads via `appInfo.getVersionInWeirdWindowsForm(...)`
(`node_modules/app-builder-lib/out/targets/AppxTarget.js:191-192`) to produce the manifest's
`Version` string.

AppX identities require **exactly four** numeric parts (`major.minor.patch.revision`); the repo's
version is three-part semver (e.g. `1.3.0`). The Store reserves the fourth part for itself and
requires it to be `0` on every upload, so `apply-identity.mjs` always pads with `.0` — `1.3.0`
becomes `1.3.0.0` — and forces the fourth part to `0` even if the source version somehow already
had one, rather than trusting it. If the root version is missing or unparseable, the script throws
instead of falling back to anything (that silent-fallback shape is exactly how the `0.1.0.0` bug
went unnoticed) — see `computeAppxVersion`/`readRootPackageVersion` in `scripts/apply-identity.mjs`
and `tests/unit/store-apply-identity.test.mjs`.

**Bumping the appx's Store version means bumping the app's own release version** (the repo-root
`package.json`) — nothing in this folder needs to change. This has only been verified at the
config level on Linux (see "What was NOT verified here"); the manifest itself is only provable by
a `store-package` CI run on Windows.

## Permission decision

`getUserMedia` (microphone) and `requestMIDIAccess` (MIDI, including sysex) only work if Electron's
session grants them. The allow/deny decision lives in `lib/permission-policy.js` — a small pure
function with no Electron import, `isAllowed({ permission, requestingOrigin, requestingUrl,
webContentsUrl, appFileUrl })` — unit-tested standalone at
`tests/unit/store-permission-policy.test.mjs` (`node --test`, no Electron required). `main.js`
calls it from both `session.setPermissionRequestHandler` and `session.setPermissionCheckHandler`,
passing every identifying argument Electron gives those handlers.

It allows a request only when:

- `permission` is exactly `media`, `midi`, or `midiSysex` (never a wildcard, never any other
  permission Electron might ask about — geolocation, notifications, clipboard, etc.), and
- at least one of `requestingUrl` (from the handler's `details` object) or `webContentsUrl`
  (`webContents.getURL()`) is present, parses as a `file:` URL, and its host+path exactly match
  the app's own `band-coach.html` file — and if BOTH are present, they must agree.

It never trusts `requestingOrigin` alone. Per Electron's docs
(https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler,
`electron` pinned to `44.4.3` in `package.json`), `setPermissionCheckHandler`'s third argument is
"The origin URL of the permission check", and both handlers can additionally receive a `details`
object whose `requestingUrl` is "The last URL the requesting frame loaded." The docs do not say how
Chromium serializes an *origin* for a `file://` page specifically (it can plausibly come through as
the literal file URL, a bare `file://`/`file:///`, or the opaque string `"null"` — origins for
non-http(s) schemes are not standardized the way http(s) origins are). Rather than guess which form
applies on Windows, `requestingOrigin` is used only as a defense-in-depth veto — a request whose
origin is unambiguously remote (`http:`/`https:`/`ws:`/`wss:`/`ftp:`) is denied immediately, even if
a URL field were somehow spoofed to match — while the actual allow decision always requires a
provable full-URL match via `requestingUrl`/`webContentsUrl`. If neither URL field is present, the
request is denied (fail closed), never granted on origin comparison alone.

**Unverified:** whether Electron 44 on Windows ever reports `requestingUrl`/`webContentsUrl` as
empty/undefined for a legitimate in-app `getUserMedia()`/`requestMIDIAccess()` call from the loaded
`file://` page (which would make this handler wrongly deny a real request, i.e. fail safe but
break the feature) — this can only be confirmed by running the packaged app on Windows and watching
whether the mic/MIDI prompt behaves as the browser build does. See "What was NOT verified here".

## Building a Store submission package

`npm run dist:appx` (what the tag-triggered `store-package` CI workflow runs) builds successfully
with the committed placeholder identity when `BC_IDENTITY_NAME`/`BC_PUBLISHER`/
`BC_PUBLISHER_DISPLAY_NAME` aren't set — that's intentional so CI keeps working before real
identity values exist.

`npm run dist:appx:submission` is the same build with the identity guard turned on
(`apply-identity.mjs --require-identity`): it refuses (non-zero exit, naming exactly which of the
three env vars are missing) to write a config that still has ANY placeholder identity field. Use it
for a package you actually intend to upload to Partner Center, with the three real values from
"Getting the real identity values" below set in the environment:

```
BC_IDENTITY_NAME=<Package/Identity/Name> \
BC_PUBLISHER=<Package/Identity/Publisher> \
BC_PUBLISHER_DISPLAY_NAME=<PublisherDisplayName> \
npm --prefix store run dist:appx:submission
```

Real identity values come only from Partner Center — never invent or guess one.

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

## Trying the shell on Windows without packaging it

`scripts/try-shell.ps1` runs this shell **unpackaged** on a real Windows machine. It is the cheapest
way to check the things neither headless CI nor a Linux box can: a real microphone, a real MIDI
keyboard, and Electron's permission handlers against a real `file://` page. It needs no code-signing
certificate and no Windows SDK, because it never builds an `.appx` — it runs the same `main.js` and
`lib/permission-policy.js` the packaged app runs.

```
powershell -ExecutionPolicy Bypass -File <repo>\store\scripts\try-shell.ps1
```

It installs dependencies, builds the one-file app, copies it in with `prepare-app`, prints a
pass/fail checklist (microphone, MIDI, the tuner's hold-through-decay, progress surviving a restart)
and launches Electron with `--enable-logging` so the app's console output lands in the terminal —
the shell's menu deliberately has no developer tools, so that flag is the only way to see an error.
Pass `-SkipInstall` on later runs to skip the `npm ci` steps.

A failure here is a real failure: if the microphone or MIDI is denied in this mode, it is denied in
the packaged app too. It does **not** exercise the `.appx` manifest's capability declaration or the
Store's own install path — see below.

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
- **The version stamping is only verified at the generated-config level** (`tests/unit/store-apply-
  identity.test.mjs` checks `config.extraMetadata.version`, and the code path to
  `AppInfo.getVersionInWeirdWindowsForm()` is read from `app-builder-lib`'s source, not exercised).
  Whether `AppxManifest.xml`'s actual `Identity/@Version` comes out as `X.Y.Z.0` can only be
  confirmed by reading the manifest out of a real `store-package` CI artifact.
