# OrthoCAD print bridge credential helper.
# Reads a protocol on stdin: set|get|delete, account, optional secret.
# The secret is never written to a log. Ciphertext is DPAPI LocalMachine.
$ErrorActionPreference = "Stop"
$raw = [Console]::In.ReadToEnd()
$parts = $raw -split "`n", 3
$op = $parts[0].Trim()
$account = if ($parts.Length -gt 1) { $parts[1].Trim() } else { "" }
$secret = if ($parts.Length -gt 2) { $parts[2] } else { "" }
if ($account -notmatch "^[A-Za-z0-9_-]{1,64}$") { exit 1 }
Add-Type -AssemblyName System.Security
$path = Join-Path $PSScriptRoot "$account.dpapi"
if ($op -eq "set") {
    $bytes = [Text.Encoding]::UTF8.GetBytes($secret)
    $protected = [Security.Cryptography.ProtectedData]::Protect(
        $bytes,
        $null,
        [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    [IO.File]::WriteAllBytes($path, $protected)
    exit 0
}
if ($op -eq "get") {
    if (-not (Test-Path -LiteralPath $path)) { exit 1 }
    $protected = [IO.File]::ReadAllBytes($path)
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protected,
        $null,
        [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
    exit 0
}
if ($op -eq "delete") {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    exit 0
}
exit 1
