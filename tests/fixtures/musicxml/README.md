# MusicXML fixtures — real files, not hand-authored

These three files come from the W3C Music Notation Community Group's official
`musicxml` repository (https://github.com/w3c/musicxml, mirrored at
https://github.com/w3c-cg/musicxml), branch `gh-pages`, commit
`0e07478fa86d6b7561e2e5a3f9f037ceb310018c` (fetched 2026-09-23), under
`docs/src/data/examples/musicxml/`. That repository has no separate `LICENSE`
file. These are the examples in the MusicXML 4.0 Reference, which is published
under the W3C Community Final Specification Agreement (FSA)
(https://www.w3.org/2021/06/musicxml40/: "Copyright © 2004-2021 the
Contributors to the MusicXML Specification, published by the Music Notation
Community Group under the W3C Community Final Specification Agreement"). FSA
§2.1 (https://www.w3.org/community/about/process/final/) grants a "perpetual
..., worldwide, non-exclusive, no-charge, royalty-free, copyright license ... to
reproduce, prepare derivative works of, publicly display, publicly perform,
sublicense, distribute, and implement the Specification". The spec page does not
say separately whether its examples are covered; they are published as part of
it. None of the three
carries any third-party copyright/`<rights>` notice in its `<identification>`
block, so — unlike some of the repo's other tutorial files (e.g.
`tutorial-apres-un-reve.musicxml`, which is marked "Copyright © 2002
MakeMusic, Inc." and was deliberately left out of this set) — there is no
embedded rights claim being overridden here. A larger real conformance file
(`voice-direction-element.musicxml`, ties across measures, 5 voices) and a
second real Finale export (`tutorial-chord-symbols.musicxml`, `<harmony>`
chord symbols) were tried first and read correctly, but were dropped to stay
under this change's diff-size cap — see "What was tried and dropped" below.

- `tutorial-chopin-prelude.musicxml` (479 lines / 14,776 bytes) — a real
  Finale export (`<encoding><software>Finale v28.0 for Mac</software>`) of
  Chopin's Prelude Op. 28 (public-domain music). Exercises: two staves,
  three simultaneous voices (`1`, `2`, `3`), `<chord/>` groups,
  `<backup>`/`<forward>`, `<key><mode>minor</mode></key>` with negative
  `<fifths>`, `<time symbol="common">`, a `<sound tempo="40"/>` and a
  separate `<direction><sound dynamics="112"/></direction>` with no `tempo`
  attribute (must not be misread as a tempo change).
- `harmonic-element.musicxml` (90 lines / 2,162 bytes) — the W3C group's own
  conformance example for the `<harmonic>` technical notation. Exercises: a
  4-note `<chord/>` group with `<notations><technical><harmonic>>` markup
  the importer doesn't understand and must ignore, `<accidental>sharp</accidental>`
  alongside a real `<alter>`, no `<key>`/`<time>`/`<sound>` at all (the
  importer's null-key/default-metre/120bpm-with-warning fallbacks).
- `barline-multiple-coda.musicxml` (68 lines / 1,538 bytes) — the W3C
  group's own conformance example for multiple `<coda/>` markers on one
  `<barline>`. Exercises: `<divisions>` declared once in measure 1's
  `<attributes>` and never repeated (measures 2–5 have no `<attributes>` at
  all, so the value must persist), `<rest measure="yes"/>` whole-measure
  rests with no `<voice>` element, and a `<barline>` with three `<coda/>`
  children that the importer doesn't look at and must silently skip.

Counts below (used as independent-of-the-importer expected values in
`tests/unit/import-musicxml-real.test.mjs`) were derived by a standalone
regex sweep of each file's `<note>...</note>` elements, not by running the
importer:

| file | `<note>` elements | non-rest, non-grace | rests |
|---|---|---|---|
| tutorial-chopin-prelude.musicxml | 27 | 27 | 0 |
| harmonic-element.musicxml | 4 | 4 | 0 |
| barline-multiple-coda.musicxml | 5 | 0 | 5 |

## What was tried and dropped

`tutorial-chord-symbols.musicxml` (a real Finale export with `<harmony>`
chord-symbol blocks) and `voice-direction-element.musicxml` (the W3C
conformance example with two `<tie>` pairs that each cross a `<measure>`
boundary, and 5 simultaneous `<voice>` ids) were fetched, read against the
importer by hand and confirmed correct — the importer handled both without
any code change. They are not included here only because adding both would
have pushed this change's fixture text over the repo's diff-size cap; ties
and multi-voice flattening are already covered by hand-authored XML in
`tests/unit/import-musicxml.test.mjs`. A later change is free to add either
file back (same source/commit above) if more real-file tie/harmony coverage
is wanted.

## `.mxl` fixture

There is no small real-world `.mxl` (compressed MusicXML) file included here:
finding one under a clear permissive licence and under ~150 KB was not
feasible in the time available. Instead `tests/unit/import-musicxml-real.test.mjs`
builds a `.mxl` archive itself (same minimal zip writer already used by
`tests/unit/import-mxl.test.mjs`) around the real
`tutorial-chopin-prelude.musicxml` text above, so the archive *structure* is
synthetic but the MusicXML *content* being read through the zip/container.xml
path is the same real file. This is noted plainly in that test, not claimed
as a real `.mxl` produced by notation software.
