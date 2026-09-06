$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
function Invoke-Npm([string[]]$Arguments) {
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) { throw "npm failed: $Arguments" }
}
Push-Location $studioRoot
try {
    Invoke-Npm -Arguments @('install', '--prefix', '.runtime', 'node@22.16.0', 'ffmpeg-static@5.3.0', 'ffprobe-static@3.1.0')
    $env:PATH = "$studioRoot\.runtime\node_modules\node\bin;$env:PATH"
    foreach ($studioDir in @('backend-node', 'frontweb', 'desktop')) {
        Push-Location (Join-Path $studioRoot $studioDir)
        try { Invoke-Npm -Arguments @('ci') } finally { Pop-Location }
    }
} finally { Pop-Location }
