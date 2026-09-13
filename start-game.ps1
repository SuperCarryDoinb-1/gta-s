$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$gameUrl = 'http://127.0.0.1:5175/'
if (-not (Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue)) {
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    Start-Process -FilePath $npmCommand -ArgumentList 'run dev -- --host 127.0.0.1 --port 5175 --strictPort' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
}
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $gameUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Game server did not start on port 5175.' }
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
