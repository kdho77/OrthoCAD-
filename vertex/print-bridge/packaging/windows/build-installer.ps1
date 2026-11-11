# Assemble and compile the Windows installer. The shop user does not run this.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $here "..\dist"
$stage = Join-Path $here "stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
$payload = Join-Path $stage "payload"
New-Item -ItemType Directory -Path (Join-Path $payload "node") | Out-Null
Copy-Item (Join-Path $here "orthocad-print-bridge.iss") $stage
Copy-Item (Join-Path $here "OrthoCADPrintBridge.xml") $stage
Copy-Item (Join-Path $here "dpapi-store.ps1") $payload
Copy-Item (Join-Path $dist "bridge.mjs") $payload
Copy-Item (Join-Path $dist "prepare-config.mjs") $payload
Copy-Item (Join-Path $dist "update-public-keys.json") $payload
$originFile = Join-Path $dist "cloud-origin.txt"
if (Test-Path $originFile) { Copy-Item $originFile $payload }
$manifestFile = Join-Path $dist "update-manifest-url.txt"
if (Test-Path $manifestFile) { Copy-Item $manifestFile $payload }
Copy-Item (Get-Command node).Source (Join-Path $payload "node\node.exe")
$winsw = Join-Path $stage "OrthoCADPrintBridge.exe"
Invoke-WebRequest -Uri "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe" -OutFile $winsw
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { throw "Inno Setup 6 is not installed." }
& $iscc "/O$dist" (Join-Path $stage "orthocad-print-bridge.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed." }
Write-Output "Built OrthoCAD-Print-Bridge-Setup.exe"
