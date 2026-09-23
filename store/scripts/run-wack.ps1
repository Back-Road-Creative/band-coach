# Runs the Windows App Certification Kit (appcert.exe) against the built
# .appx on the store-package Windows runner, writing its XML report to
# -Report. scripts/wack-verdict.mjs then reads that report and fails the job
# on FAIL. Partner Center runs the same kit on every submission; before this,
# the first WACK run any Band Coach package got was Microsoft's.
#
# appcert has to INSTALL the package, and Windows only installs a signed one.
# So this signs a COPY with a throwaway self-signed certificate whose subject
# is the manifest's own Publisher (read out of the .appx, so it cannot drift
# from what was packaged) and trusts that certificate on this machine only.
# The uploaded artifact stays the unsigned .appx; the Store signs on ingest.
#
# Usage (elevated; the hosted Windows runner is):
#   pwsh -File store/scripts/run-wack.ps1 -Appx <path.appx> -Report <wack.xml>

[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Appx,
  [Parameter(Mandatory)] [string]$Report
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$appcert = Join-Path $kits 'App Certification Kit\appcert.exe'
if (-not (Test-Path $appcert)) { throw "appcert.exe not found at $appcert (Windows SDK App Certification Kit missing)" }
$signtool = Get-ChildItem (Join-Path $kits 'bin') -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw "signtool.exe not found under $kits\bin" }

$Appx = (Resolve-Path $Appx).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Appx)
try {
  $entry = $zip.GetEntry('AppxManifest.xml')
  if (-not $entry) { throw "no AppxManifest.xml in $Appx" }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $zip.Dispose() }
$publisher = $manifest.Package.Identity.Publisher
if (-not $publisher) { throw "the manifest in $Appx has no Identity/@Publisher" }
Write-Host "Publisher: $publisher"

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("bc-wack-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$signed = Join-Path $work (Split-Path $Appx -Leaf)
Copy-Item $Appx $signed

# Code-signing EKU (1.3.6.1.5.5.7.3.3), not a CA (empty basic constraints):
# what MSIX packaging accepts for a sideload signature.
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
  -FriendlyName 'Band Coach WACK throwaway' -CertStoreLocation 'Cert:\CurrentUser\My' `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cer = Join-Path $work 'wack.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint /s My $signed
if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }

& $appcert reset
$reportDir = Split-Path -Parent $Report
if ($reportDir) { New-Item -ItemType Directory -Force -Path $reportDir | Out-Null }
& $appcert test -appxpackagepath $signed -reportoutputpath $Report
if ($LASTEXITCODE -ne 0) { Write-Host "appcert exited $LASTEXITCODE; the report decides" }
if (-not (Test-Path $Report)) { throw "appcert wrote no report at $Report" }
