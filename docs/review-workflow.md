# Reviewing teaching content: the review packet

Band Coach's teaching content (curriculum wording, which song a player is offered next, pathway
step copy) is written by the app's authors, not checked by a real musician against any method book
or standard -- see `src/instruments/review.js` and the empty `LEDGER` in
`src/instruments/review-ledger.js`. A review packet is how a real player checks it, item by item,
without touching a build tool or a dev server.

## Building a packet

```
npm run review-packet -- kbd
```

writes `dist/review-packet-kbd.html`, a single downloadable page with no external dependency of
any kind -- open it directly in a browser, offline, on any machine. Pass `--out <path>` to write it
somewhere else:

```
npm run review-packet -- kbd --out ~/Desktop/kbd-review.html
```

`--out` matters because `npm run build` and `npm test` both wipe `dist/` on every run (see
`build/build.mjs`'s dev build, which deletes and recreates `dist/` from scratch) -- a packet left
under the default path will not survive the next build. Copy it out, or build straight to a path
outside `dist/`, before running either command again.

Today only `kbd` (the keyboard trainer) is supported; an unknown instrument name exits with an
error instead of a wrong or empty page.

## What each column means

- **Text** -- the content item as the app itself would show or use it.
- **Expected** -- what the reviewer should actually try to do or check, in plain language, derived
  from the same data the app uses (not new teaching copy invented for the packet).
- **Source** -- the repo file the item comes from, so a correction points straight at what to edit.
- **Id / Rev** -- the item's stable content id and a content fingerprint (see below). Shown for
  reference, so a correction can be traced back to the exact content it was marked against; a
  reviewer does not need to read either column to do the review.
- **Play** -- when the item has known notes, a button that plays them through the browser's own
  audio, so the reviewer can hear what the app expects without a real instrument connected.
- **Verdict / Note** -- Pass, or Correction with a note describing what's wrong.

## The id/rev contract

Every row's id is a stable name for one piece of content (a curriculum level, a song hand-off
suggestion, a pathway step's copy). Its rev is a short fingerprint of that content's exact current
value (`contentRev` in `src/instruments/review-ledger.js`). Editing the underlying item -- even a
wording tweak -- changes its rev. That is deliberate: a review result recorded against an old rev
is stale the moment the content it covered changes, the same way `src/instruments/review.js`'s
`isReviewCurrent` already treats a stale `reviewedRev` as unreviewed. Nobody has to remember to
clear a review by hand.

## The result file

"Download result" refuses (with a visible message) until Reference, Reviewed by and Reviewed at are
all filled in. It then downloads `review-result-<instrument>.json`, containing only the rows the
reviewer actually marked:

```json
{
  "schema": "band-coach-review-result/1",
  "instrument": "kbd",
  "reference": "Alfred's Basic Piano Library, Level 1",
  "reviewedBy": "A. Player",
  "reviewedAt": "2026-09-27",
  "items": [
    { "id": "kbd.curriculum.1", "rev": "62201985", "verdict": "pass", "note": "" }
  ]
}
```

## Applying a result

Downloading a result file does not change anything in the app by itself -- nothing here writes to
`src/instruments/review-ledger.js`'s `LEDGER`. Applying a result (turning `pass` rows into real
ledger entries) is a separate step, `npm run review-apply`, not yet available in this repo.
