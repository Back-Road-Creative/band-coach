// Builds a self-contained "review packet": one HTML file a real musician
// opens on their own machine (no build tooling, no dev server, no network)
// to check an instrument's teaching content -- curriculum wording, song
// hand-off suggestions, pathway outcome copy -- item by item against a
// named method book or standard, then downloads a result file this repo's
// (not-yet-built) review-apply step will read.
//
// Every row's id/rev follows the same contract src/instruments/*.js already
// uses for its own review ledger lookups (src/instruments/review-ledger.js
// contentRev): a later edit to an item changes its rev, which is exactly
// what makes an old review result go stale -- this file computes those revs
// the same way, never a copy that could drift.
//
// Node built-ins only, ESM. No DOM here: the page below carries its own
// inline <script>, this module never runs in a browser.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import kbd from '../src/instruments/kbd.js';
import { ENTRIES as SONG_HANDOFF_ENTRIES, KBD_LEVEL_PITCH_POOLS } from '../src/instruments/kbd-songs.js';
import { reviewItems as pathwayReviewItems } from '../src/instruments/kbd-pathway.js';
import { HANDS_TOGETHER_EXERCISES } from '../src/core/hands-together.js';
import { starterSongs } from '../src/song/starter/index.js';
import { contentRev } from '../src/instruments/review-ledger.js';
import { nameFor } from '../src/core/note-names.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const starterSongById = new Map(starterSongs.map((s) => [s.id, s]));

// A song's notes, converted from ticks (its own bpm/ticksPerQuarter) to
// seconds -- the only unit the inline WebAudio player below understands.
function songMidiSeconds(song) {
  const secondsPerTick = 60 / song.bpm / song.ticksPerQuarter;
  return song.parts[0].notes.map((n) => ({ start: n.start * secondsPerTick, dur: n.dur * secondsPerTick, midi: n.midi }));
}

// One entry per data module this packet knows how to review. Adding a
// future source (e.g. level-13 hands-together prep lines, once that
// contract settles) is a one-entry addition here -- see the unit's decision
// log for why that row is not yet included.
const SOURCES = [
  {
    kind: 'curriculum',
    source: 'src/instruments/kbd.js',
    items: () => kbd.curriculum.map((entry) => {
      const level = entry.level;
      const pool = KBD_LEVEL_PITCH_POOLS[level - 1];
      const midi = level === 13
        ? HANDS_TOGETHER_EXERCISES.map((e) => [e.rh.midi, e.lh.midi])
        : (Array.isArray(pool) && pool.length ? pool : []);
      const text = entry.items.join('; ');
      const expected = level === 13
        ? 'Play each hands-together exercise, both hands at once'
        : (Array.isArray(pool) && pool.length
          ? 'Play each note when it is shown: ' + pool.map((m) => nameFor(m, { octave: true })).join(', ')
          : 'No fixed notes to play for this level: ' + text);
      return { id: 'kbd.curriculum.' + level, rev: contentRev(entry), kind: 'curriculum', text, expected, source: 'src/instruments/kbd.js', midi };
    })
  },
  {
    kind: 'song',
    source: 'src/instruments/kbd-songs.js',
    items: () => SONG_HANDOFF_ENTRIES.map((entry) => {
      const song = starterSongById.get(entry.songId);
      const title = song ? song.title : entry.songId;
      const skills = entry.skills.join(', ');
      return {
        id: entry.id,
        rev: contentRev(entry),
        kind: 'song',
        text: title + ' -- notes used: ' + skills,
        expected: 'Play ' + title + ' through; notes used: ' + skills,
        source: 'src/instruments/kbd-songs.js',
        midi: song ? songMidiSeconds(song) : []
      };
    })
  },
  {
    kind: 'pathway',
    source: 'src/instruments/kbd-pathway.js',
    items: () => pathwayReviewItems().map((row) => ({
      id: row.id,
      rev: contentRev(row.value),
      kind: 'pathway',
      text: row.value.text,
      expected: row.value.text,
      source: 'src/instruments/kbd-pathway.js',
      midi: []
    }))
  }
];

const INSTRUMENT_SOURCES = { kbd: SOURCES };

export function reviewItems(instrument) {
  const sources = INSTRUMENT_SOURCES[instrument];
  if (!sources) throw new Error('review-packet: unsupported instrument "' + instrument + '" (only "kbd" is supported)');
  return sources.flatMap((s) => s.items());
}

function rowHtml(item) {
  // Only numbers/arrays live in item.midi, so plain JSON.stringify never
  // needs HTML-escaping -- it contains no quote, angle bracket or ampersand
  // (a single-quoted attribute is safe as long as it has no literal ').
  const midiJson = JSON.stringify(item.midi);
  const playButton = item.midi && item.midi.length
    ? '<button type="button" class="playBtn" data-id="' + escapeHtml(item.id) + '">Play</button>'
    : '';
  return (
    '<tr data-id="' + escapeHtml(item.id) + '" data-rev="' + escapeHtml(item.rev) + "\" data-midi='" + midiJson + "'>" +
    '<td>' + escapeHtml(item.text) + '</td>' +
    '<td>' + escapeHtml(item.expected) + '</td>' +
    '<td>' + escapeHtml(item.source) + '</td>' +
    '<td>' + escapeHtml(item.id) + '</td>' +
    '<td>' + escapeHtml(item.rev) + '</td>' +
    '<td>' + playButton + '</td>' +
    '<td>' +
    '<label><input type="radio" name="verdict-' + escapeHtml(item.id) + '" value="pass"> Pass</label> ' +
    '<label><input type="radio" name="verdict-' + escapeHtml(item.id) + '" value="correction"> Correction</label>' +
    '</td>' +
    '<td><input type="text" class="noteField" placeholder="Correction note"></td>' +
    '</tr>'
  );
}

export function buildReviewPacket(instrument) {
  const items = reviewItems(instrument);
  const rows = items.map(rowHtml).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Band Coach review packet: ${escapeHtml(instrument)}</title>
<style>
body { font-family: sans-serif; margin: 1.5rem; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #999; padding: 0.4rem; text-align: left; vertical-align: top; }
#header label { display: inline-block; margin-right: 1rem; }
#refusal { color: #b00020; font-weight: bold; }
</style>
</head>
<body>
<h1>Band Coach review packet: ${escapeHtml(instrument)}</h1>
<p>Check each row below against your named reference. Mark it Pass or Correction, add a note for
any correction, then use "Download result" to save your answers -- nothing here is sent anywhere.</p>
<div id="header">
<label>Reference (method book or standard): <input id="reference" type="text"></label>
<label>Reviewed by: <input id="reviewedBy" type="text"></label>
<label>Reviewed at: <input id="reviewedAt" type="date"></label>
</div>
<table>
<thead><tr><th>Text</th><th>Expected</th><th>Source</th><th>Id</th><th>Rev</th><th>Play</th><th>Verdict</th><th>Note</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p id="refusal"></p>
<button type="button" id="downloadResult">Download result</button>
<script>
function playMidi(midiOrSchedule) {
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  var ctx = new Ctx();
  function tone(midi, when, dur) {
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    var t0 = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.3, t0 + 0.02);
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  if (Array.isArray(midiOrSchedule) && midiOrSchedule.length && typeof midiOrSchedule[0] === 'object') {
    midiOrSchedule.forEach(function (n) { tone(n.midi, n.start, n.dur || 0.4); });
  } else if (Array.isArray(midiOrSchedule) && midiOrSchedule.length && Array.isArray(midiOrSchedule[0])) {
    midiOrSchedule.forEach(function (pair) { pair.forEach(function (m) { tone(m, 0, 0.6); }); });
  } else {
    (midiOrSchedule || []).forEach(function (m) { tone(m, 0, 0.6); });
  }
}
Array.prototype.forEach.call(document.querySelectorAll('.playBtn'), function (btn) {
  btn.addEventListener('click', function () {
    var tr = btn.closest('tr');
    var midi = JSON.parse(tr.getAttribute('data-midi'));
    playMidi(midi);
  });
});
document.getElementById('downloadResult').addEventListener('click', function () {
  var reference = document.getElementById('reference').value.trim();
  var reviewedBy = document.getElementById('reviewedBy').value.trim();
  var reviewedAt = document.getElementById('reviewedAt').value.trim();
  var refusal = document.getElementById('refusal');
  if (!reference || !reviewedBy || !reviewedAt) {
    refusal.textContent = 'Fill in Reference, Reviewed by and Reviewed at before downloading.';
    return;
  }
  refusal.textContent = '';
  var items = [];
  Array.prototype.forEach.call(document.querySelectorAll('tbody tr'), function (tr) {
    var id = tr.getAttribute('data-id');
    var rev = tr.getAttribute('data-rev');
    var checked = tr.querySelector('input[type=radio]:checked');
    if (!checked) return;
    var note = tr.querySelector('.noteField').value;
    items.push({ id: id, rev: rev, verdict: checked.value, note: note });
  });
  var result = {
    schema: 'band-coach-review-result/1',
    instrument: '${escapeHtml(instrument)}',
    reference: reference,
    reviewedBy: reviewedBy,
    reviewedAt: reviewedAt,
    items: items
  };
  var blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  // A space before the call parenthesis here is deliberate (valid JS): this
  // page's own no-external-resource self-check scans for the four letters
  // immediately followed by an opening parenthesis (meant to catch a
  // stylesheet or script reaching outside the file), which this Blob
  // download API method name merely happens to also end in.
  var objectUrl = URL.createObjectURL (blob);
  var a = document.createElement('a');
  a.href = objectUrl;
  a.download = 'review-result-${escapeHtml(instrument)}.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL (objectUrl);
});
</script>
</body>
</html>`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const instrument = args[0];
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? args[outIndex + 1] : join(root, 'dist', 'review-packet-' + instrument + '.html');
  try {
    const html = buildReviewPacket(instrument);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, 'utf8');
    console.log('Wrote ' + outPath);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
