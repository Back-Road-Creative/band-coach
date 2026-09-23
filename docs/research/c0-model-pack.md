# C0 — size and speed of a Basic Pitch model pack

Spike for plan row C0. Everything below is measured on this box (AMD Ryzen 7
7435HS, 12 logical CPUs, Node v22.22.2) unless marked UNVERIFIED. Commands are
given so any number can be reproduced. Working files: `/tmp/.../scratchpad/c0/`
(not in this repo).

## 1. Package: `@spotify/basic-pitch` 1.0.1

`npm pack @spotify/basic-pitch` → `spotify-basic-pitch-1.0.1.tgz` (599.7 KB
tarball, 66 files). License file present at `package/LICENSE`: Apache License
2.0 (confirmed by reading the file header and `package.json`'s
`"license": "Apache-2.0"`).

The package ships a real model, `package/model/`:

| file | bytes |
|---|---|
| `model.json` | 174,537 |
| `group1-shard1of1.bin` | 742,392 |

`model.json.weightsManifest` parsed (`python3 -c "json.load(...)"`): 245
tensors total, split by dtype:

| dtype | tensor count | params | fp32-equiv bytes |
|---|---|---|---|
| float32 (real weights: conv kernels + biases) | 43 | 184,949 | 739,796 |
| int32 (shape/index consts, not model weights) | 202 | 649 | 2,596 |
| **total** | 245 | 185,598 | 742,392 (matches `.bin` exactly) |

**Layer types actually present** — parsed the op list out of
`modelTopology.node` (this is a frozen TF **GraphDef**, not a Keras layers
model):

```
245 Const, 53 Transpose, 28 ExpandDims, 26 Conv2D, 26 Squeeze, 24 StridedSlice,
22 Pad, 15 Pack, 9 MirrorPad, 9 Neg, 6 Shape, 6 Reshape, 6 _FusedConv2D,
4 ConcatV2, 3 Mul, 3 Sigmoid, ... (500 nodes total)
```

**There is no GRU or LSTM op anywhere in the graph**, and no standalone
BatchNorm op either — this plan's assumption of a "conv/pool/GRU" kernel is
wrong for this model. It is Conv2D/FusedConv2D (batchnorm folded into the
conv weights at export, as is normal for inference graphs) + Sigmoid +
reshape/pad/slice bookkeeping. A hand-written kernel for this graph needs
conv2d, pooling, sigmoid, and tensor reshuffling ops — no recurrent kernel.

## 2. int8 quantisation

Computed and then actually measured.

**Computed** (from the real per-tensor float32 params above): 43 quantizable
tensors, 184,949 params × 1 byte = 184,949 bytes, + 43 × 8 bytes (min/max as
2×float32 per tensor, the scheme `tfjs-converter --quantize_uint8` uses) = 344
bytes overhead → **185,293 bytes computed**.

**Measured**: wrote a Python script (`quantize.py` logic inline, numpy) that
reads `model.json`'s weightsManifest in order, walks the `.bin` file at the
matching byte offsets, and for every float32 tensor computes per-tensor
min/max, quantizes to uint8, and re-packs (int32 const tensors passed through
unchanged, matching what `tfjs-converter` does).

| | raw bytes | gzip bytes | command |
|---|---|---|---|
| original fp32 `.bin` | 742,392 | 426,299 | `gzip -9` on the shipped file |
| int8-quantized weights (43 tensors quantized + 202 int32 consts passed through, excl. 344B scale metadata) | 187,545 | 24,111 | numpy script above + `gzip -9` |
| int8 total incl. scale metadata | 187,889 | ~24,400 (est., metadata too small to move gzip materially) | computed |

So: **measured int8 pack ≈ 183 KB raw / ≈ 24 KB gzip'd** — both far under the
plan's unverified "~2.2 MB weights / ≈0.6 MB int8" estimate. The real
fp32 model is 742 KB, not 2.2 MB; that number in the plan (`:836`) was wrong
by ~3x even before quantization.

## 3. Runtime size: hand-written kernel vs ONNX Runtime Web vs tfjs

`npm pack` + extract, then measured the actual browser-shipped minified
files (not the full source tarball, which includes tests/sourcemaps/tsbuildinfo
noise):

| runtime | file | raw bytes | gzip bytes |
|---|---|---|---|
| `@tensorflow/tfjs-core` 4.22.0 | `dist/tf-core.min.js` | 294,062 | 82,809 |
| `@tensorflow/tfjs-backend-cpu` 4.22.0 | `dist/tf-backend-cpu.min.js` | 132,422 | 37,874 |
| **tfjs core+cpu total** | | **426,484** | **120,683** |
| `onnxruntime-web` 1.30.0 | `dist/ort.wasm.min.js` (JS glue, wasm-only build, no webgl/webgpu) | 50,196 | 16,123 |
| `onnxruntime-web` 1.30.0 | `dist/ort-wasm-simd-threaded.wasm` (the actual wasm binary — ORT ships one all-ops build) | 14,239,897 | 3,659,955 |
| **ORT-web wasm total** | | **14,290,093** | **3,676,078** |
| hand-written kernel prototype (conv2d+bias+relu+batchnorm+sigmoid+maxpool, 98 source lines, this spike) | `kernel-proto.min.js` via repo's `node_modules/.bin/esbuild --minify` | 1,276 | 719 |

Caveat on the hand-written row: this prototype covers the math ops only. The
real graph also needs Transpose/Pad/MirrorPad/StridedSlice/Reshape/Squeeze/
ConcatV2 glue (see op histogram above) to actually run this exact graph
end-to-end; a complete hand-written interpreter for this graph would be
larger than 1.3 KB but, given how mechanical those ops are, is very unlikely
to approach tfjs's 120 KB gzip, let alone ORT's 3.7 MB gzip. Not measured:
the complete interpreter (would need a multi-day build, out of scope for C0).

**tfjs, not ONNX Runtime Web, is the size risk here** — ORT-web's wasm binary
(3.66 MB gzip / 14.2 MB raw) is the "5–10 MB runtime" the plan worried about;
tfjs core+cpu (120 KB gzip) is not.

## 4. Speed: realtime factor on this CPU

AMD Ryzen 7 7435HS (`/proc/cpuinfo`), 12 logical CPUs, Node v22.22.2.
Synthetic input: 10 s of a sine chord (261.63/329.63/392.00 Hz) at 22050 Hz,
run through the *actual* shipped model (`model.json` + `.bin` loaded via a
custom local `IOHandler`, no network), windowed exactly as
`BasicPitch.prepareData` does (2 s windows, hop = window − 30-frame overlap
→ 5 windows for 10 s).

| backend | realtime factor (compute-s / audio-s) | note |
|---|---|---|
| `@tensorflow/tfjs` pure-JS `cpu` backend (the honest no-WebGPU browser proxy) | **1.836** (18.36 s compute for 10 s audio) | measured, `node speed-test.mjs` |
| `@tensorflow/tfjs-node` (native C++ binding) | UNVERIFIED | prebuilt native addon (`tfjs_binding.node`) did not download for this environment/platform combo; not worth building from source in the ~20 min budget. Would only be relevant as a Node-side proxy anyway, not a browser number. |
| WebGPU | UNVERIFIED | no headless WebGPU device available in this sandbox; not measured, not estimated. |

**A realtime factor of 1.836 means the plain-JS CPU backend is slower than
realtime (≈0.54× speed)** on this hardware for this exact model + tfjs's own
JS CPU backend. This is tfjs's op-dispatch overhead on top of the same
Conv2D-heavy graph — not a hand-written-kernel number (not measured; a tight
kernel could beat this or lose to it depending on how much time goes into
JS-level tensor bookkeeping vs raw math, and that was out of scope to build
here).

## Verdict

- **Size**: an int8 basic-pitch pack is measured at **~183 KB raw / ~24 KB
  gzip** — trivially fits any reasonable download budget, nowhere near the
  plan's 0.6 MB estimate. This part of C0 is a clear win.
- **Speed**: the one number that should decide C1 vs stay-T0 is the realtime
  factor. Measured on tfjs's own pure-JS CPU backend (closest proxy to "no
  WebGPU" in a real browser): **1.836× — i.e. SLOWER than realtime.**
  WebGPU speed, which the plan explicitly wants tested, could not be measured
  here (no headless WebGPU device) — that gap is real and unresolved.
- Runtime-size risk is on the ONNX Runtime Web side (3.66 MB gzip wasm), not
  tfjs (120 KB gzip) — if C1 goes ahead, prefer tfjs's graph-execution path
  (or a from-scratch kernel) over ORT-web on pure size grounds regardless of
  speed.

**Recommendation: stay-T0 for now, pending a WebGPU number.** The two
decision numbers are: pack size ~183 KB (fine) and CPU-JS realtime factor
1.836 (fails "faster than realtime" on this box's plain JS backend). Basic
Pitch's own 2 s-window / 30-frame-overlap design means only the CPU path was
measurable without a browser; if a real WebGPU measurement later shows
sub-1.0 realtime factor, that changes the call to C1. Until then, the
measured plain-JS number does not clear the bar the plan set.

**The speed bar depends on the use.** "Faster than realtime" is the bar for
listening to the mic live. Transcribing a loaded audio file is offline: at
1.836× a 3-minute recording takes about 5½ minutes on this CPU. That is slow but
workable behind a progress bar. So a file-import-only T1 pack is a product call
for JP, not something this measurement rules out. The comment at
`src/audio/file-frames.js:17` rejected basic-pitch as "~2.2 MB". That figure is
refuted here: the weights are 742,392 B (fp32) and 187,545 B (int8). The comment
should be corrected whenever that file is next touched.
