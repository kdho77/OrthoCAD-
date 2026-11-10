# Authenticode-sign the Windows installer. Does nothing harmful when the org certificate is absent.
param(
    [string]$Installer = "print-bridge\packaging\dist\OrthoCAD-Print-Bridge-Setup.exe"
)
$ErrorActionPreference = "Stop"
if (-not $env:ORTHOCAD_AUTHENTICODE_THUMBPRINT) {
    Write-Output "Authenticode signing skipped. Set ORTHOCAD_AUTHENTICODE_THUMBPRINT when the organization certificate is installed."
    exit 0
}
if (-not (Test-Path -LiteralPath $Installer)) {
    Write-Error "Installer not found: $Installer"
    exit 1
}
$cert = Get-ChildItem -Path Cert:\CurrentUser\My, Cert:\LocalMachine\My |
    Where-Object { $_.Thumbprint -eq $env:ORTHOCAD_AUTHENTICODE_THUMBPRINT } |
    Select-Object -First 1
if (-not $cert) {
    Write-Error "The Authenticode certificate thumbprint was not found in the local certificate store."
    exit 1
}
Set-AuthenticodeSignature -FilePath $Installer -Certificate $cert -TimestampServer "http://timestamp.digicert.com" | Out-Null
Write-Output "Signed $Installer"
