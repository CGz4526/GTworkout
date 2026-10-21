param([switch]$EnableRegistration)
$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot 'compose.yaml'
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker engine is unavailable. Start Docker Desktop first.' }

if (-not $env:WORKOUT_DB_PASSWORD) {
    $databaseId = & docker ps -a --filter label=com.docker.compose.project=workout --filter label=com.docker.compose.service=db --format '{{.ID}}'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the project database service.' }
    if ($databaseId) {
        if (@($databaseId).Count -ne 1) { throw 'Multiple project database containers found; refusing automatic credential selection.' }
        $containerInfo = (& docker inspect $databaseId | ConvertFrom-Json)[0]
        if ($containerInfo.Config.Labels.'com.docker.compose.project' -ne 'workout' -or
            $containerInfo.Config.Labels.'com.docker.compose.service' -ne 'db') {
            throw 'Database container ownership mismatch. No changes were made.'
        }
        $passwordEntry = $containerInfo.Config.Env | Where-Object { $_.StartsWith('POSTGRES_PASSWORD=') }
        if (-not $passwordEntry) { throw 'Provide the original WORKOUT_DB_PASSWORD for the existing database.' }
        $env:WORKOUT_DB_PASSWORD = $passwordEntry.Substring('POSTGRES_PASSWORD='.Length)
    } else {
        $existingVolume = & docker volume ls --filter name=workout_postgres_data --format '{{.Name}}'
        if ($existingVolume -contains 'workout_postgres_data') {
            throw 'An existing project volume was found. Inject its original WORKOUT_DB_PASSWORD; no reset will be performed.'
        }
        $randomBytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
        $env:WORKOUT_DB_PASSWORD = [Convert]::ToBase64String($randomBytes)
    }
}
if ($EnableRegistration) { $env:WORKOUT_REGISTRATION_ENABLED = 'true' }
& docker compose -f $composeFile up --build -d --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Compose startup failed. Existing data was preserved; inspect service logs.' }
Write-Host 'Workout is available at http://localhost:8088 (local machine only).'
