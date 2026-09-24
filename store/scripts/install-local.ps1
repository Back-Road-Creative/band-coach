# Installs the unsigned Band Coach .appx that the store-package workflow
# uploads (artifact `band-coach-appx`) on THIS Windows machine, so the app a
# Partner Center reviewer installs can be tried by hand first: the Store tile,
# the packaged Electron shell, its microphone/MIDI permission prompts, and
# progress kept under the package's own app-data folder.
#
# Windows only installs a signed package, and the Store signs on ingest, so
# this does what scripts/run-wack.ps1 does on the CI runner: sign a COPY with a
# throwaway self-signed certificate whose subject is the manifest's own
# Publisher (read out of the .appx so it cannot drift), trust that certificate
# on this machine only, then Add-AppxPackage the signed copy. The original
# .appx is never modified -- upload that one, not the signed copy.
#
# Needs: an elevated PowerShell (the certificate goes into
# LocalMachine\TrustedPeople), the Windows SDK's signtool.exe, and Developer
# Mode or sideloading enabled (Settings > System > For developers).
#
# Usage (elevated):
#   pwsh -File store/scripts/install-local.ps1 -Appx <path.appx>
# Remove it again:
#   pwsh -File store/scripts/install-local.ps1 -Appx <path.appx> -Uninstall

[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Appx,
  [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Appx = (Resolve-Path $Appx).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Appx)
try {
  $entry = $zip.GetEntry('AppxManifest.xml')
  if (-not $entry) { throw "no AppxManifest.xml in $Appx" }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $zip.Dispose() }
$identity = $manifest.Package.Identity
$publisher = $identity.Publisher
$name = $identity.Name
if (-not $publisher -or -not $name) { throw "the manifest in $Appx has no Identity/@Publisher or @Name" }
Write-Host "Package: $name  Publisher: $publisher  Version: $($identity.Version)"

if ($Uninstall) {
  $installed = Get-AppxPackage -Name $name
  if (-not $installed) { Write-Host "$name is not installed."; exit 0 }
  Remove-AppxPackage -Package $installed.PackageFullName
  Write-Host "Removed $($installed.PackageFullName)."
  exit 0
}

$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$signtool = Get-ChildItem (Join-Path $kits 'bin') -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw "signtool.exe not found under $kits\bin (install the Windows SDK)" }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("bc-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$signed = Join-Path $work (Split-Path $Appx -Leaf)
Copy-Item $Appx $signed

# Code-signing EKU (1.3.6.1.5.5.7.3.3), not a CA (empty basic constraints):
# what MSIX packaging accepts for a sideload signature -- same as run-wack.ps1.
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
  -FriendlyName 'Band Coach local-install throwaway' -CertStoreLocation 'Cert:\CurrentUser\My' `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cer = Join-Path $work 'install.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint /s My $signed
if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }

$existing = Get-AppxPackage -Name $name
if ($existing) {
  Write-Host "Replacing installed $($existing.PackageFullName)"
  Remove-AppxPackage -Package $existing.PackageFullName
}
Add-AppxPackage -Path $signed
$installed = Get-AppxPackage -Name $name
if (-not $installed) { throw "Add-AppxPackage reported no error but $name is not installed" }
Write-Host "Installed $($installed.PackageFullName). Open it from the Start menu as 'Band Coach'."
Write-Host "Signed copy and certificate are throwaways in $work; the original $Appx is untouched."
