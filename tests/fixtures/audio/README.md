# Real-audio evaluation corpus

This directory ships **empty**. `src/song/eval/pcm.js`'s `evaluateManifest()` reads a corpus from
here if one exists, and reports `{ clips: [], skipped: 'no corpus' }` when it does not (the current
state of this checkout) -- so running the eval never fails just because no clips have been added
yet.

## What goes here

- `manifest.json` at the top of this directory, plus one WAV file per clip it references.
- Every clip must be a recording you own the rights to, or one already released CC0 (public
  domain) -- nothing under a licence that restricts redistribution or reuse. Nothing in this
  directory is ever downloaded by the app itself or by any test; the app has no network access to
  audio at all, and neither does this harness.
- Every clip's note labels must be written independently of listening to what the app's own
  detector reports -- label from the score/recording first, run the eval second. A label copied
  from the app's own output would only ever measure the app agreeing with itself.

## `manifest.json` format

An array, one entry per clip:

```json
[
  {
    "file": "clip-01-c-major-scale.wav",
    "instrument": "keys",
    "sampleRate": 44100,
    "license": "CC0",
    "source": "recorded by JP, 2026-09-24, upright piano",
    "labelledBy": "JP",
    "notes": [
      { "midi": 60, "startSec": 0.0, "durSec": 0.4 },
      { "midi": 62, "startSec": 0.5, "durSec": 0.4 }
    ]
  }
]
```

- `file`: path to the WAV, relative to this directory.
- `instrument`: either a plain string label (used only for grouping in the per-instrument
  summary) or an instrument record (`{ name, range: { low, high } }`, `src/instruments/schema.js`
  shape) if you want `evaluateClip`'s pitch search window narrowed the same way Learn this narrows
  it for a real instrument.
- `sampleRate` is optional -- the WAV file's own header rate is used when present; only set it to
  override a file with a missing or wrong header.
- `license`, `source`, `labelledBy` are free text, required so every clip's provenance is
  traceable months later.
- `notes`: the ground-truth labels, `{ midi, startSec, durSec }` each, in onset order.

## Running the eval once a corpus exists

```js
import { evaluateManifest } from '../src/song/eval/pcm.js';
const result = evaluateManifest('tests/fixtures/audio');
```

Returns `{ clips: [...], perInstrument: {...} }` -- see `src/song/eval/pcm.js`'s header comment
for exactly what each clip's result and the per-instrument summary contain.
