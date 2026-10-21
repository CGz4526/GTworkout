param([string]$BaseUrl = 'http://localhost:8088')
$ErrorActionPreference = 'Stop'
if ($BaseUrl -notin @('http://localhost:8088', 'http://127.0.0.1:8088')) {
    throw 'This script only targets the local Workout deployment.'
}
$projectRoot = Split-Path $PSScriptRoot -Parent
$cacheDirectory = Join-Path $projectRoot '.cache'
New-Item -ItemType Directory -Force $cacheDirectory | Out-Null
$name = 'smoke_' + [Guid]::NewGuid().ToString('N').Substring(0, 16)
$password = [Guid]::NewGuid().ToString('N')
$webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
function Get-Csrf {
    (Invoke-RestMethod "$BaseUrl/api/v1/auth/csrf" -WebSession $webSession).token
}
Write-Host 'Checking local registration, session, upload, replay and download...'
$body = @{ username = $name; password = $password } | ConvertTo-Json -Compress
$account = Invoke-RestMethod "$BaseUrl/api/v1/auth/register" -Method Post -WebSession $webSession `
    -ContentType 'application/json' -Body $body -Headers @{ 'X-CSRF-TOKEN' = (Get-Csrf) }
Invoke-RestMethod "$BaseUrl/api/v1/auth/login" -Method Post -WebSession $webSession `
    -Body @{ username = $name; password = $password } -Headers @{ 'X-CSRF-TOKEN' = (Get-Csrf) } | Out-Null
$me = Invoke-RestMethod "$BaseUrl/api/v1/auth/me" -WebSession $webSession
if ($me.id -ne $account.id) { throw 'Session identity mismatch.' }

$filePath = Join-Path $cacheDirectory 'p1-smoke-backup.json'
$downloadPath = Join-Path $cacheDirectory 'p1-smoke-download.json'
$raw = '{"version":3,"exercises":[{"id":"synthetic-squat","name":"Synthetic squat","bodyPart":"腿"}],"templates":[],"sessions":[{"id":"synthetic-session","date":"2026-10-15T16:30:00Z","duration":600,"finished":true,"exercises":[{"exerciseId":"synthetic-squat","exerciseName":"Synthetic squat","sets":[{"weight":40,"reps":10,"completed":true}]}]}],"weights":[{"date":"2026-10-16","weight":70,"updatedAt":1792108800000}],"synthetic":true}'
[System.IO.File]::WriteAllText($filePath, $raw, (New-Object System.Text.UTF8Encoding($false)))
$key = [Guid]::NewGuid().ToString()
function Upload-Synthetic {
    Invoke-WebRequest "$BaseUrl/api/v1/backups" -Method Post -WebSession $webSession `
        -Headers @{ 'X-CSRF-TOKEN' = (Get-Csrf); 'Idempotency-Key' = $key; 'X-Expected-User' = $account.id } `
        -Form @{ timezone = 'Asia/Shanghai'; file = (Get-Item -LiteralPath $filePath) }
}
$created = Upload-Synthetic
if ($created.StatusCode -notin @(201,202)) { throw 'Initial upload did not return 201 or 202.' }
$metadata = $created.Content | ConvertFrom-Json
if ($created.StatusCode -eq 202) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    do {
        $job = Invoke-RestMethod "$BaseUrl/api/v1/jobs/$($metadata.jobId)" -WebSession $webSession
        if ($job.status -eq 'FAILED') { throw "Projection failed with code $($job.errorCode)." }
        if ($job.status -eq 'SUCCEEDED') { break }
        Start-Sleep -Milliseconds 200
    } while ($watch.Elapsed.TotalSeconds -lt 30)
    if ($job.status -ne 'SUCCEEDED') { throw 'Projection did not complete within the smoke-test deadline.' }
    $statistics = Invoke-RestMethod "$BaseUrl/api/v1/backups/$($metadata.id)/statistics" -WebSession $webSession
    if ($statistics.summary.volume -ne 400 -or $statistics.summary.trainingDays -ne 1) { throw 'Synthetic training statistics mismatch.' }
    @{ backupId = $metadata.id; jobId = $metadata.jobId; username = $name } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cacheDirectory 'p2-smoke-resource.json')
    Write-Host 'PASS: durable projection job, READY visibility, deterministic training statistics.'
}
$replay = Upload-Synthetic
if ($replay.StatusCode -ne 200 -or ($replay.Content | ConvertFrom-Json).id -ne $metadata.id) {
    throw 'Idempotency replay mismatch.'
}
Invoke-WebRequest "$BaseUrl/api/v1/backups/$($metadata.id)/download" -WebSession $webSession -OutFile $downloadPath
$expectedHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
if ((Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Download digest mismatch.' }

# Restart only the containers owned by this Compose project; no volume operations.
foreach ($service in @('db', 'server')) {
    $containerId = & docker ps --filter label=com.docker.compose.project=workout --filter "label=com.docker.compose.service=$service" --format '{{.ID}}'
    if ($LASTEXITCODE -ne 0 -or @($containerId).Count -ne 1 -or -not $containerId) { throw "Expected one project $service container." }
    & docker restart $containerId | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to restart project $service container." }
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $health = & docker inspect --format '{{.State.Health.Status}}' $containerId
        if ($health -eq 'healthy') { $healthy = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { throw "Project $service did not become healthy." }
}
$restored = Invoke-RestMethod "$BaseUrl/api/v1/auth/me" -WebSession $webSession
if ($restored.id -ne $account.id) { throw 'JDBC session did not survive restart.' }
Invoke-WebRequest "$BaseUrl/api/v1/backups/$($metadata.id)/download" -WebSession $webSession -OutFile $downloadPath
if ((Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Backup did not survive restart.' }
if ($metadata.jobId) {
    $statistics = Invoke-RestMethod "$BaseUrl/api/v1/backups/$($metadata.id)/statistics" -WebSession $webSession
    if ($statistics.summary.volume -ne 400) { throw 'Projection did not survive restart.' }
}
Invoke-WebRequest "$BaseUrl/api/v1/auth/logout" -Method Post -WebSession $webSession -Headers @{ 'X-CSRF-TOKEN' = (Get-Csrf) } | Out-Null
Write-Host 'PASS: registration, JDBC session, upload replay, byte digest, database/server restart persistence, logout.'
Write-Host 'One synthetic account and backup were retained in this project database; no records were deleted.'
