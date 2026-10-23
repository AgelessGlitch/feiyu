# Backup: memories + bilibili login + config -> one zip
# Usage: double-click backup.bat, or:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'backups'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$ts = Get-Date -Format 'yyyyMMdd-HHmm'
$stage = Join-Path $out ('_stage-' + $ts)
New-Item -ItemType Directory -Force -Path $stage | Out-Null

foreach ($d in @('qq-memory', 'weixin-memory', 'bili-memory', 'feiyu')) {
    $p = Join-Path $root $d
    if (Test-Path $p) { Copy-Item $p (Join-Path $stage $d) -Recurse -Force }
}

$cookie = Join-Path $root 'bili\login\cookie.json'
if (Test-Path $cookie) { Copy-Item $cookie (Join-Path $stage 'bili-cookie.json') -Force }

$data = Join-Path $root 'bili\data'
if (Test-Path $data) { Copy-Item $data (Join-Path $stage 'bili-data') -Recurse -Force }

foreach ($f in @('bili\config.json', 'ROADMAP.md')) {
    $p = Join-Path $root $f
    if (Test-Path $p) { Copy-Item $p (Join-Path $stage (Split-Path $f -Leaf)) -Force }
}

$zip = Join-Path $out ('feiyu-backup-' + $ts + '.zip')
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host ('OK  ' + $zip + '  (' + $size + ' KB)')
Write-Host 'NOTE: the zip contains bilibili cookie. Do not share it.'
