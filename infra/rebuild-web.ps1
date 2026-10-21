#requires -Version 7.4
$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot 'compose.yaml'
$originalPassword = $env:WORKOUT_DB_PASSWORD

function Get-ProjectContainer([string]$Service) {
    $ids = @(& docker ps --filter label=com.docker.compose.project=workout --filter "label=com.docker.compose.service=$Service" --format '{{.ID}}')
    if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) {
        throw "Expected exactly one running workout $Service container."
    }
    return $ids[0]
}

$databaseId = Get-ProjectContainer 'db'
$serverId = Get-ProjectContainer 'server'
try {
    if (-not $env:WORKOUT_DB_PASSWORD) {
        $database = (& docker inspect $databaseId | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -ne 0 -or
            $database.Config.Labels.'com.docker.compose.project' -ne 'workout' -or
            $database.Config.Labels.'com.docker.compose.service' -ne 'db') {
            throw 'Database container ownership mismatch.'
        }
        $entries = @($database.Config.Env | Where-Object { $_.StartsWith('POSTGRES_PASSWORD=') })
        if ($entries.Count -ne 1) { throw 'Original database credential is unavailable.' }
        $env:WORKOUT_DB_PASSWORD = $entries[0].Substring('POSTGRES_PASSWORD='.Length)
    }
    & docker compose -f $composeFile up --build -d --no-deps --wait --wait-timeout 120 web
    if ($LASTEXITCODE -ne 0) { throw 'Web rebuild failed; inspect build output.' }
    if ((Get-ProjectContainer 'db') -ne $databaseId -or (Get-ProjectContainer 'server') -ne $serverId) {
        throw 'Unexpected database/server container change detected.'
    }
    Write-Host 'Web updated. Existing database and server containers were preserved.'
} finally {
    $env:WORKOUT_DB_PASSWORD = $originalPassword
}
