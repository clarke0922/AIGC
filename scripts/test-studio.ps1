$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioNode = Join-Path $studioRoot '.runtime\node_modules\node\bin\node.exe'
$env:FFMPEG_PATH = Join-Path $studioRoot '.runtime\node_modules\ffmpeg-static\ffmpeg.exe'
$env:FFPROBE_PATH = Join-Path $studioRoot '.runtime\node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe'
$env:STUDIO_MEDIA_TEST = '1'
foreach ($studioDir in @('backend-node', 'frontweb')) {
    Push-Location (Join-Path $studioRoot $studioDir)
    try {
        & $studioNode --test
        if ($LASTEXITCODE -ne 0) { throw "$studioDir tests failed" }
    } finally { Pop-Location }
}
