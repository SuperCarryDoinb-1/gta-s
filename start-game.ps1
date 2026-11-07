param([switch]$Built)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$gameUrl = 'http://127.0.0.1:5175/'
if (-not (Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue)) {
    $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
    if ($Built) {
        $entry = Join-Path $PSScriptRoot 'scratchpad\polish-build\index.html'
        if (-not (Test-Path -LiteralPath $entry)) { throw 'Production build missing: scratchpad/polish-build.' }
        $serverScript = Join-Path $PSScriptRoot 'tools\serve-built.mjs'
        $serverArguments = '"' + $serverScript + '"'
    } else {
        $viteScript = Join-Path $PSScriptRoot 'node_modules\vite\bin\vite.js'
        $serverArguments = '"' + $viteScript + '" --host 127.0.0.1 --port 5175 --strictPort'
    }
    Start-Process -FilePath $nodeCommand -ArgumentList $serverArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
}
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $gameUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200 -and $response.Content.Contains('id="start-btn"')) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Game server did not start on port 5175.' }
if ($Built -and $response.Headers['X-Shanghai-Game'] -ne 'production') {
    throw 'Port 5175 is running the development game. Close that server before launching the production build.'
}
if ($Built) {
    # Match game-launcher.bat's default-browser profile to preserve its saves.
    Start-Process $gameUrl
    exit
}
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chromePath)) { throw 'Google Chrome was not found.' }
# Separate profile: autoplay flags apply even when normal Chrome is already running.
$gameProfile = Join-Path $PSScriptRoot '.game-browser'
Start-Process -FilePath $chromePath -ArgumentList @(
    ('--user-data-dir="' + $gameProfile + '"'),
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    ('--app=' + $gameUrl)
)
