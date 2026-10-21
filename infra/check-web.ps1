#requires -Version 7.4
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$batch = [Guid]::NewGuid().ToString('N')
$name = "workout-web-check-$batch"
$label = "workout.web-check=$batch"
$projectRoot = Split-Path $PSScriptRoot -Parent
$checks = [System.Collections.Generic.List[object]]::new()
$created = $false

function Read-Response([string]$Path) {
    $lines = @(& docker exec $name wget -S -O - "http://127.0.0.1$Path" 2>&1 | ForEach-Object { "$_" })
    return $lines -join "`n"
}
function Assert-Response([string]$Path, [int]$Status, [string]$Cache = '', [string]$Body = '') {
    $response = Read-Response $Path
    $passed = $response -match "HTTP/1\.[01] $Status\b"
    if ($Cache) { $passed = $passed -and $response -match "Cache-Control: $Cache" }
    if ($Body) { $passed = $passed -and $response.Contains($Body) }
    $checks.Add(@{ path = $Path; expectedStatus = $Status; expectedCache = $Cache; passed = [bool]$passed })
    if ($passed) { Write-Host "PASS: $Path status=$Status cache=$Cache" }
    else { Write-Host "FAIL: $Path expected status=$Status cache=$Cache" }
}

try {
    $imageId = & docker image inspect workout-web:p3 --format '{{.Id}}'
    if ($LASTEXITCODE -ne 0) { throw 'Build the local web image first; this check does not pull images.' }
    & docker run --pull never -d --name $name --label $label --network none --memory 128m $imageId | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated web check container.' }
    $created = $true
    & docker exec $name nginx -t 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Nginx configuration validation failed.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker exec $name wget -q -O /dev/null http://127.0.0.1/healthz 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'Isolated web service did not become ready.' }
    Assert-Response '/healthz' 200 '' 'ok'
    Assert-Response '/index.html' 200 'no-cache' '<div id="root">'
    Assert-Response '/history' 200 'no-cache' '<div id="root">'
    Assert-Response '/cloud' 200 'no-cache' '<div id="root">'
    Assert-Response '/sw.js' 200 'no-cache'
    Assert-Response '/manifest.webmanifest' 200 'no-cache'
    $index = Read-Response '/index.html'
    $asset = [regex]::Match($index, '/assets/[^"\s]+\.js').Value
    if (-not $asset) { throw 'Cannot locate the built entry JavaScript asset.' }
    Assert-Response $asset 200 'public, max-age=31536000, immutable'
    Assert-Response '/assets/__missing__.js' 404
    Assert-Response '/assets/__missing__.css' 404
    Assert-Response '/actuator/health' 404
    if (@($checks | Where-Object { -not $_.passed }).Count -gt 0) { throw 'Web response contract checks failed.' }
} finally {
    $reportPath = Join-Path $projectRoot ".cache/web-check-$batch.json"
    if (Test-Path (Split-Path $reportPath -Parent)) {
        @{ timestampUtc = [DateTime]::UtcNow.ToString('O'); imageId = $imageId; checks = @($checks.ToArray()) } |
            ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
    }
    if ($created) {
        $owner = & docker inspect $name --format '{{index .Config.Labels "workout.web-check"}}'
        if ($LASTEXITCODE -ne 0 -or $owner -ne $batch) { throw 'Check container ownership mismatch; refusing cleanup.' }
        & docker rm -f $name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to reclaim this check container.' }
    }
}
Write-Host "PASS: $($checks.Count) isolated web checks; report $reportPath"
