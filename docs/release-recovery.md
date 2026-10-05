# Withdrawing a bad release

A tag push makes three things at once: a GitHub release with `band-coach.html` attached
(`.github/workflows/release.yml`), a GitHub Pages copy with its `version.json`
(`.github/workflows/pages.yml`), and a Windows Store package build
(`.github/workflows/store-package.yml`). A bad release has to be pulled from each one separately,
and none of the workflows has a "withdraw" mode. This page is the order to do it in and what each
step does and does not fix. It describes only what is in this repo; anything about the Microsoft
Store that this repo cannot show is marked **confirm with JP**.

Who does it: whoever can run `gh` with write access to `Back-Road-Creative/band-coach` and
trigger workflows. Nothing here needs a code change except the last section's new release.

## Decide first: withdraw or fix forward

Read this before touching anything, because it is the part that surprises people.

- A downloaded `band-coach.html` cannot update or replace itself. The "Check for updates" button
  asks the Pages `version.json` and only compares numbers (`src/core/update-check.js`,
  `checkForUpdate`): the file is told it is **behind** only when the live version is higher than
  its own.
- So if you put an older Pages copy back, a learner holding the bad file (say 1.9.1) asks, sees live
  1.9.0, and is told **up-to-date**. Rolling Pages back does not bring anyone back; it only stops
  new installs of the phone copy getting the bad build.
- The way to move people off a bad file is a **new, higher version** (a new patch release, 1.9.2)
  that contains the fix or the last good code. Then the button tells every holder of 1.9.1 that
  they are behind and links to `releases/latest/download/band-coach.html`.

Withdrawing (below) stops the bleeding; the new release (last section) is what repairs people.
Do both. Do the withdrawal steps first and quickly; they are reversible.

## 1. The GitHub release

Every README download link and the update button's fallback point at
`https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html`.
GitHub resolves "latest" to the newest published, non-draft release.

1. Hold it (reversible): turn the bad release back into a draft. A draft is not public and is not
   "latest", so the link above falls back to the previous good release.

   ```
   gh release edit vX.Y.Z --draft --repo Back-Road-Creative/band-coach
   ```

2. Check it worked: open the `releases/latest/download/band-coach.html` URL in a private window
   and confirm it serves the last good tag's file (compare the version in the footer, or the
   sha256 against the record in [release-acceptance-record.md](release-acceptance-record.md)).
3. When you are sure it stays withdrawn, delete it. The tag stays unless you also pass
   `--cleanup-tag`; leave the tag, so the history shows what was withdrawn.

   ```
   gh release delete vX.Y.Z --repo Back-Road-Creative/band-coach
   ```

Replacing the asset in place (`gh release upload vX.Y.Z band-coach.html --clobber`) is possible,
but the file then no longer matches the tag's build, and holders of the bad file still see the same
version number, so they are never told to update. Prefer a new version.

`release-consistency.yml` runs only after a successful `release.yml`, and checks the release for
the tag it was given. Do not re-run it for a withdrawn tag; it will fail, correctly.

## 2. The Pages copy and `version.json`

The phone copy at `https://back-road-creative.github.io/band-coach/` and the `version.json` the
update button reads are deployed by `pages.yml`. It runs on a `v*` tag push and by hand.

To put the last good build back:

1. Find the last good tag: `gh release list --repo Back-Road-Creative/band-coach`, or the
   latest signed-off candidate in [release-acceptance-record.md](release-acceptance-record.md).
2. Actions, then `pages`, then Run workflow, and choose that **tag** as the ref (not `main`).
   The workflow checks out that tag, confirms the tag matches the `package.json` version in it,
   builds `dist/pages/` and deploys it.
3. Check: `https://back-road-creative.github.io/band-coach/version.json` reports the last good
   version. Deployment can lag by a few minutes.

Things to know:

- `version.json`'s `released` date is written at build time, so the redeployed file carries
  today's date, not the old tag's. The version and download URL are the ones that matter.
- The phone copy's service worker names its cache after the version (`band-coach-pages-v<version>`,
  `build/pages.mjs`). A different version means a different `sw.js`, so installed copies pick up
  the redeployed build on a later visit and delete the old cache. A page already open keeps the
  old build until it is reloaded.
- If the run is refused or the deploy step fails, look at the `github-pages` environment's
  deployment rules under repo Settings. Whether a tag ref is allowed there is a setting this repo
  does not record: **confirm with JP**.

## 3. The Store build

`store-package.yml` builds an unsigned `.appx` on every `v*` tag and uploads it as a workflow
artifact; `release-consistency.yml` opens a `Store submission for vX.Y.Z` issue so the manual
Partner Center upload is tracked. The submission itself is made by hand, outside this repo
(`store/README.md`).

- If the bad version has **not** been submitted: do not submit it. Comment on the
  `Store submission for vX.Y.Z` issue that it is withdrawn and close it.
- If it **has** been submitted or is live: what Partner Center lets you do (cancel a submission in
  review, roll back to an earlier package, how long certification takes for the replacement) is not
  something this repo documents or can test. **Confirm with JP** before promising anyone a time.
  Do not assume a published Store version can be recalled.
- A replacement appx takes a new version: the appx version is derived from the repo-root
  `package.json` (`store/README.md`, "Where the appx version comes from"), and the Store rejects a
  second submission at a version it already has.

## 4. What to tell learners

Say it in everyday words, once, wherever the download link was shared (the Headless Mode site is
notified by `release.yml` and also polls daily; **confirm with JP** how its copy gets edited).
Cover: what went wrong, whether progress was affected, what to do now. Template:

> We withdrew Band Coach X.Y.Z because <plain description, e.g. "it could lose practice progress
> when you saved a backup">. If you downloaded it, please stop using that file and do not delete it
> yet. Download the fixed version (X.Y.Z+1) from <link>. Your progress lives in your browser, tied to
> where the file was opened from, so first open Settings in the file you have now and press "Save a
> backup". Then open the new file and use "Restore a backup".

Keep it truthful: if you do not yet know whether progress was damaged, say that. Never say
the problem is fixed until the new release is published and the five-minute check in the README
has been run on the downloaded file.

## 5. Restoring a backup into an older file

A learner who wants to go back to the last good file keeps their data like this:

1. Open the old (good) `band-coach.html`. Progress is stored per file path, so a file opened from a
   new location starts empty. That is expected.
2. Settings, "Restore a backup", and choose their `band-coach-progress.json`. The app asks before
   it replaces progress and songs together.

What a backup does when the older file cannot take it
(`src/core/progress-file.js`, `importProgress`; frozen examples in
`tests/fixtures/backups/`, covered by `tests/unit/golden-backups.test.mjs`):

- A backup written by a **newer** Band Coach than the file doing the restoring is refused with
  "This backup was made by a newer Band Coach. Update the app to restore it." This happens before
  any "replace your progress" question, and the learner's current progress and songs are left
  untouched. Backups from the bad release are refused this way by an older file if the bad release
  raised the backup format number. There is **no downgrade converter** in this repo, so such a
  learner cannot go back; they need the fixed new release, which reads it. Do not tell them to edit
  the JSON by hand.
- A damaged file, a file that is not a backup, or one with a damaged song is refused with its own
  message and nothing changes.
- A backup written by an older app than the one restoring it is migrated up and loads, so a backup
  saved *before* the bad release restores into either the good old file or the new release.
  The best backup to use is the last one made before the bad release; the learner may have to say
  which one that was by its file date.

## 6. Ship the replacement

1. Fix on `main` (or revert the bad change there), with the usual review.
2. Bump `package.json` to a version **higher than the bad one** (the update button only compares
   numbers; see the first section), tag it `vX.Y.Z`, and push the tag. See "Releasing" in
   [README.md](../README.md#releasing).
3. Wait for `release.yml`, `pages.yml`, `store-package.yml` and `release-consistency.yml` to go
   green, then run the README's five-minute human check on the downloaded file, and record
   the candidate in [release-acceptance-record.md](release-acceptance-record.md). A new release gets
   its own record; it does not inherit the earlier sign-off.
4. Only then send the learner message from section 4 with the new link.
