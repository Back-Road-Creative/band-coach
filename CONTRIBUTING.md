# Contributing to Band Coach

Band Coach is one downloadable `band-coach.html`, built from `src/`. This page points you at the
places that already say how to work on it.

## Start here

- [Build it from source](README.md#build-it-from-source): install, build, and the screenshot and
  review-packet helpers.
- [Test](README.md#test): the test scripts, what each family runs, and which ones drive a browser.
- [docs/ci.md](docs/ci.md): what runs in CI.
- [docs/review-workflow.md](docs/review-workflow.md): how a real player checks the teaching content.

## The short version

1. You need Node 22 or newer.
2. `npm ci`
3. `npm run build` writes `dist/band-coach.html`.
4. `npm test`. Run `npm run build` first: the tests open the built page, and a test whose page is
   missing fails at once.
5. Keep a change to one thing, and update the README (or the doc that describes it) in the same
   change.

## Before you open a change

- Pure logic goes in `src/core/*.js` with a unit test in `tests/unit/`; browser behaviour has a test
  in `tests/characterization/`.
- Write the failing test first, and watch it fail before you fix it.
- Say plainly in the README what a learner can and cannot rely on. Do not claim a browser, device
  or instrument works until someone has actually tried it; the README's "Browser and device support"
  section lists what has.
