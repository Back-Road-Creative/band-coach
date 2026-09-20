# Runs the Band Coach Windows Store shell UNPACKAGED, to check the things no
# headless test and no Linux CI job can: a real microphone, a real MIDI
# keyboard, and Electron's permission handlers against a real file:// page.
#
# This is not the .appx. It runs the same store/main.js and
# store/lib/permission-policy.js that the packaged app runs, without needing a
# code-signing certificate or the Windows SDK. If the microphone or MIDI fails
# HERE, it would fail in the packaged app too, and that is the bug worth finding.
#
# Usage, from anywhere:
#   powershell -ExecutionPolicy Bypass -File <repo>\store\scripts\try-shell.ps1
# Re-running after the first time:
#   ... \try-shell.ps1 -SkipInstall

[CmdletBinding()]
param(
  # Skip `npm ci` in both places. Use on a second run; the installs take
  # several minutes and download the Electron binary (~100 MB).
  [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSCommandPath
$storeDir = Split-Path -Parent $here
$repoRoot = Split-Path -Parent $storeDir

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Fail($text) { Write-Host "FAIL: $text" -ForegroundColor Red; exit 1 }

Step "Checking prerequisites"
foreach ($cmd in 'node', 'npm') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Fail "$cmd is not on PATH. Install Node 22 or newer from https://nodejs.org and reopen this window."
  }
}
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($nodeMajor -lt 22) { Fail "Node $nodeVersion found; this repo needs 22 or newer." }
Write-Host "node $nodeVersion, repo at $repoRoot"

if (-not (Test-Path (Join-Path $storeDir 'main.js'))) {
  Fail "Could not find store\main.js. Run this script from inside the band-coach checkout."
}

if (-not $SkipInstall) {
  Step "Installing the app's build dependencies (repo root)"
  Push-Location $repoRoot
  try { & npm ci; if ($LASTEXITCODE -ne 0) { Fail "npm ci failed in the repo root." } }
  finally { Pop-Location }
}

Step "Building the one-file app"
Push-Location $repoRoot
try { & npm run build; if ($LASTEXITCODE -ne 0) { Fail "npm run build failed." } }
finally { Pop-Location }

if (-not $SkipInstall) {
  Step "Installing the Electron shell (store) - this downloads Electron, be patient"
  Push-Location $storeDir
  try { & npm ci; if ($LASTEXITCODE -ne 0) { Fail "npm ci failed in store\." } }
  finally { Pop-Location }
}

Step "Copying the built app into the shell"
Push-Location $storeDir
try { & npm run prepare-app; if ($LASTEXITCODE -ne 0) { Fail "npm run prepare-app failed." } }
finally { Pop-Location }

$appHtml = Join-Path $storeDir 'app\band-coach.html'
if (-not (Test-Path $appHtml)) { Fail "prepare-app did not produce $appHtml." }
Write-Host ("app file: {0} ({1:N0} bytes)" -f $appHtml, (Get-Item $appHtml).Length)

Write-Host @"

=== What to check once the window opens ===

The app window should appear. Leave THIS terminal visible - Electron prints the
app's console output here, which is the only way to see an error (the shell's
menu has no developer tools).

1. MICROPHONE
     Pick a microphone instrument (e.g. guitar), press "Connect microphone".
     PASS  Windows asks for microphone permission (first run only), then the
           small input-level meter moves when you play or talk.
     FAIL  No prompt appears AND the meter never moves, or connecting fails
           instantly. That means the permission handler denied it - the exact
           thing this run exists to test. Copy any red text from this terminal.

2. MIDI KEYBOARD (skip if you have none - say so rather than guessing)
     Plug the keyboard in, press "Connect MIDI".
     PASS  Status reaches "<your device> is working." after you press a key,
           and the dot next to Connect blinks on each key press.
     FAIL  It stays on "found. Press any key on it." after several key presses,
           or says MIDI was blocked.

3. TUNER HOLD (the bug that shipped in v1.2.0)
     Switch to Tuner, connect, pluck one open string ONCE and let it ring out.
     PASS  The reading stays on screen as the note decays.
     FAIL  The reading vanishes or resets to "play a note" while it is still
           ringing.

4. PROGRESS SURVIVES A RESTART
     Play a couple of exercises, close the window, run this script again with
     -SkipInstall.
     PASS  Your results are still there.
     FAIL  Progress is back to zero.

Close the window when you are done.

"@

Step "Launching (--enable-logging so app console output lands in this terminal)"
Push-Location $storeDir
try { & npx electron --enable-logging . }
finally { Pop-Location }

Write-Host "`nWindow closed." -ForegroundColor Cyan
