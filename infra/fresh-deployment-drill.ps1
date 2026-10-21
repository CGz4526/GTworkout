#requires -Version 7.4
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectRoot = Split-Path $PSScriptRoot -Parent
$batch = [Guid]::NewGuid().ToString('N')
$project = "workout-fresh-$batch"
$directory = Join-Path $projectRoot ".cache/$project"
$override = Join-Path $directory 'compose.override.yaml'
$compose = Join-Path $PSScriptRoot 'compose.yaml'
$originalPassword = $env:WORKOUT_DB_PASSWORD
$started = $false
$report = [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('O')
    project = $project
    passed = $false
    cleanupCompleted = $false
    modelRequests = 0
    checks = [System.Collections.Generic.List[string]]::new()
}

function Require([bool]$Condition, [string]$Description) {
    if (-not $Condition) { throw "Fresh deployment check failed: $Description" }
    $report.checks.Add($Description)
    Write-Host "PASS: $Description"
}
function Container([string]$Service) {
    $ids = @(& docker compose -p $project -f $compose -f $override ps -q $Service)
    if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) { throw "Cannot locate drill service $Service." }
    return $ids[0]
}

New-Item -ItemType Directory -Path $directory | Out-Null
@'
services:
  web:
    ports: !reset []
    restart: "no"
  server:
    restart: "no"
    environment:
      WORKOUT_DEEPSEEK_API_KEY: ""
      WORKOUT_DEEPSEEK_MODEL: ""
      WORKOUT_REGISTRATION_ENABLED: "false"
      WORKOUT_COOKIE_SECURE: "false"
  db:
    restart: "no"
    mem_limit: 512m
    volumes: !reset []
    tmpfs:
      - /var/lib/postgresql/data:rw,size=268435456
volumes: !reset {}
'@ | Set-Content -LiteralPath $override -Encoding utf8

try {
    $env:WORKOUT_DB_PASSWORD = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $existing = @(& docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.ID}}')
    Require ($LASTEXITCODE -eq 0 -and $existing.Count -eq 0) 'unique project has no existing containers'
    $configText = & docker compose -p $project -f $compose -f $override config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot validate the isolated Compose configuration.' }
    $config = $configText | ConvertFrom-Json
    foreach ($service in $config.services.PSObject.Properties) {
        Require (@($service.Value.ports).Where({ $null -ne $_ }).Count -eq 0) "$($service.Name) has no host ports"
        Require (@($service.Value.volumes).Where({ $null -ne $_ }).Count -eq 0) "$($service.Name) has no data volume mounts"
    }
    Require ($config.services.db.tmpfs.Count -eq 1) 'database data directory is temporary memory'
    Require ([string]::IsNullOrEmpty($config.services.server.environment.WORKOUT_DEEPSEEK_API_KEY) -and
        [string]::IsNullOrEmpty($config.services.server.environment.WORKOUT_DEEPSEEK_MODEL)) 'model configuration is explicitly empty'
    $expectedImages = @{}
    foreach ($service in @('web', 'server', 'db')) {
        $id = & docker image inspect $config.services.$service.image --format '{{.Id}}'
        if ($LASTEXITCODE -ne 0) { throw "Local $service image is unavailable; no image will be pulled." }
        $expectedImages[$service] = $id
    }
    $report.imageIds = $expectedImages
    # Never persist expanded Compose config: it contains the temporary database password.
    $configText = $null
    $config = $null
    $started = $true
    & docker compose -p $project -f $compose -f $override up -d --no-build --pull never --wait --wait-timeout 150
    Require ($LASTEXITCODE -eq 0) 'three services start healthy from an empty database'
    foreach ($service in @('web', 'server', 'db')) {
        $id = Container $service
        $info = (& docker inspect $id | ConvertFrom-Json)[0]
        Require ($info.Config.Labels.'com.docker.compose.project' -eq $project) "$service ownership matches the drill"
        Require ($info.Image -eq $expectedImages[$service]) "$service runs the expected local image"
        Require ($info.State.Health.Status -eq 'healthy') "$service is healthy"
        Require (@($info.HostConfig.PortBindings.PSObject.Properties).Count -eq 0) "$service publishes no host ports"
        Require (@($info.Mounts | Where-Object { $_.Type -ne 'tmpfs' }).Count -eq 0) "$service uses no persistent or host mounts"
    }
    $database = Container 'db'
    $schema = & docker exec $database psql -U workout -d workout -tA -c 'SELECT max(version::integer) FROM flyway_schema_history WHERE success'
    Require ($LASTEXITCODE -eq 0 -and "$schema".Trim() -eq '4') 'fresh database migrates to schema V4'
    $counts = & docker exec $database psql -U workout -d workout -tA -c 'SELECT (SELECT count(*) FROM app_user), (SELECT count(*) FROM backup_snapshot), (SELECT count(*) FROM agent_run)'
    Require ($LASTEXITCODE -eq 0 -and "$counts".Trim() -eq '0|0|0') 'fresh database contains no users, backups or Agent tasks'
    $statusText = & docker exec (Container 'web') wget -q -O - http://127.0.0.1/api/status
    if ($LASTEXITCODE -ne 0) { throw 'Fresh web cannot proxy the backend status API.' }
    $status = $statusText | ConvertFrom-Json
    Require ($status.stage -eq 'P3' -and $status.capabilities.identity -and $status.capabilities.backup -and
        $status.capabilities.training -and -not $status.capabilities.assistant) 'same-origin API works with model capability disabled'
    $report.passed = $true
} finally {
    try {
        if ($started) {
            $ids = @(& docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.ID}}')
            if ($LASTEXITCODE -ne 0) { throw 'Cannot verify drill container ownership for cleanup.' }
            foreach ($id in $ids) {
                $owner = & docker inspect $id --format '{{index .Config.Labels "com.docker.compose.project"}}'
                if ($LASTEXITCODE -ne 0 -or $owner -ne $project) { throw 'Drill ownership mismatch; cleanup refused.' }
            }
            & docker compose -p $project -f $compose -f $override down --timeout 10
            if ($LASTEXITCODE -ne 0) { throw 'Drill resource cleanup failed.' }
            $remaining = @(& docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.ID}}')
            if ($LASTEXITCODE -ne 0 -or $remaining.Count) { throw 'Drill containers remain after cleanup.' }
            $report.cleanupCompleted = $true
        }
    } finally {
        $env:WORKOUT_DB_PASSWORD = $originalPassword
        $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $directory 'result.json') -Encoding utf8
    }
}
Write-Host "Fresh deployment PASS. Evidence: $directory"
