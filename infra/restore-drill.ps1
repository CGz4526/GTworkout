#requires -Version 7.4
$ErrorActionPreference = 'Stop'
$runId = [Guid]::NewGuid().ToString('N')
$outputDir = Join-Path (Split-Path $PSScriptRoot -Parent) ".cache/recovery/$runId"
$holder = $null
$targetId = $null
$timer = [Diagnostics.Stopwatch]::StartNew()

function Invoke-DockerText([string[]]$Arguments) {
    $result = & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed ($($Arguments[0]))." }
    return $result
}

function Start-DockerProcess([string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new('docker')
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'Unable to start Docker client.' }
    return $process
}

# Binary streams bypass PowerShell text pipelines, including for custom-format dumps.
function Save-DockerOutput([string[]]$Arguments, [string]$Path) {
    $process = Start-DockerProcess $Arguments
    $errors = $process.StandardError.ReadToEndAsync()
    $file = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
    try {
        $process.StandardInput.Close()
        $process.StandardOutput.BaseStream.CopyTo($file)
        $process.WaitForExit()
        # Do not print SQL errors: they can contain row values from sensitive tables.
        $null = $errors.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "Database export/check failed ($($Arguments[0]))." }
    } finally {
        $file.Dispose()
        $process.Dispose()
    }
}

try {
    $sourceIds = @(Invoke-DockerText @('ps', '--filter', 'label=com.docker.compose.project=workout',
        '--filter', 'label=com.docker.compose.service=db', '--format', '{{.ID}}'))
    if ($sourceIds.Count -ne 1) { throw 'Exactly one running workout database is required.' }
    $sourceId = $sourceIds[0]
    $source = (Invoke-DockerText @('inspect', $sourceId) | ConvertFrom-Json)[0]
    if ($source.Config.Labels.'com.docker.compose.project' -ne 'workout' -or
        $source.Config.Labels.'com.docker.compose.service' -ne 'db') { throw 'Source ownership mismatch.' }
    # Run the identical local image; no download, global dependency or credential changes.
    $imageId = $source.Image
    $null = New-Item -ItemType Directory -Path $outputDir

    # Hold the exported read-only snapshot until both pg_dump and the manifest finish.
    $holder = Start-DockerProcess @('exec', '-i', $sourceId, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'workout', '-d', 'workout')
    $holderErrors = $holder.StandardError.ReadToEndAsync()
    $holder.StandardInput.WriteLine("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL idle_in_transaction_session_timeout='10min'; SELECT pg_export_snapshot();")
    $holder.StandardInput.Flush()
    $snapshot = $holder.StandardOutput.ReadLine()
    if ($snapshot -notmatch '^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$') { throw 'Unable to export a consistent snapshot.' }

    $dumpPath = Join-Path $outputDir 'workout.dump'
    Save-DockerOutput @('exec', $sourceId, 'pg_dump', '-U', 'workout', '-d', 'workout',
        '--format=custom', '--no-owner', '--no-privileges', "--snapshot=$snapshot") $dumpPath

    # Include all public tables, all columns and duplicate rows. Hash bytea before JSON
    # conversion to keep large backup files out of the canonical row representation.
    $catalogSql = @'
SELECT table_name, string_agg(
  CASE WHEN data_type='bytea' THEN format('encode(sha256(%I),''hex'') AS %I', column_name, column_name)
  ELSE format('%I', column_name) END, ', ' ORDER BY ordinal_position)
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
  (SELECT tablename FROM pg_tables WHERE schemaname='public')
GROUP BY table_name ORDER BY table_name;
'@
    $tables = @(Invoke-DockerText @('exec', $sourceId, 'psql', '-X', '-qAt', '-F', '|', '-v',
        'ON_ERROR_STOP=1', '-U', 'workout', '-d', 'workout', '-c', $catalogSql))
    if ($tables.Count -eq 0) { throw 'No application tables found.' }
    $queries = foreach ($table in $tables) {
        $parts = $table.Split('|', 2)
        if ($parts[0] -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Unexpected table name.' }
        "SELECT '$($parts[0])' AS tbl, encode(sha256(convert_to(row_to_json(r)::text,'UTF8')),'hex') AS fingerprint FROM (SELECT $($parts[1]) FROM public.$($parts[0])) r"
    }
    $manifestSql = "SET TIME ZONE 'UTC'; SET DateStyle='ISO, YMD'; COPY (" + ($queries -join ' UNION ALL ') + ' ORDER BY tbl, fingerprint) TO STDOUT;'
    $sourceManifest = Join-Path $outputDir 'source-manifest.txt'
    Save-DockerOutput @('exec', $sourceId, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'workout', '-d', 'workout', '-c',
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$snapshot'; $manifestSql COMMIT;") $sourceManifest
    $holder.StandardInput.WriteLine('ROLLBACK;')
    $holder.StandardInput.Close()
    $holder.WaitForExit()
    $null = $holderErrors.GetAwaiter().GetResult()
    if ($holder.ExitCode -ne 0) { throw 'Snapshot holder failed.' }
    Write-Host 'Consistent read-only export complete; restoring into an isolated temporary database.'

    # Trust applies only inside this network-less container, with no ports or persistent volume.
    $targetId = Invoke-DockerText @('run', '-d', '--network', 'none', '--memory', '256m',
        '--tmpfs', '/var/lib/postgresql/data:rw,size=1g', '--label', "workout.restore-drill=$runId",
        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=workout', '-e', 'POSTGRES_DB=workout', $imageId)
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & docker exec $targetId pg_isready -h 127.0.0.1 -U workout -d workout *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Temporary database did not become ready.' }
    $null = Invoke-DockerText @('cp', $dumpPath, "${targetId}:/tmp/workout.dump")
    # Capture errors privately because restore diagnostics may contain original values.
    Save-DockerOutput @('exec', $targetId, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
        '-U', 'workout', '-d', 'workout', '/tmp/workout.dump') (Join-Path $outputDir 'restore-output.txt')
    $targetManifest = Join-Path $outputDir 'restored-manifest.txt'
    Save-DockerOutput @('exec', $targetId, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'workout', '-d', 'workout',
        '-c', "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; $manifestSql COMMIT;") $targetManifest
    $sourceHash = (Get-FileHash $sourceManifest -Algorithm SHA256).Hash
    $restoredHash = (Get-FileHash $targetManifest -Algorithm SHA256).Hash
    if ($sourceHash -ne $restoredHash) { throw 'Restored data does not match the exported snapshot.' }
    $invalid = Invoke-DockerText @('exec', $targetId, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'workout', '-d', 'workout',
        '-c', "SELECT count(*) FROM backup_snapshot WHERE encode(sha256(raw_bytes),'hex')<>sha256 OR octet_length(raw_bytes)<>size_bytes;")
    if ($invalid -ne '0') { throw 'Restored backup byte validation failed.' }
    $summary = [ordered]@{
        result = 'PASS'; runId = $runId; timestampUtc = [DateTime]::UtcNow.ToString('o')
        imageId = $imageId; tableCount = $tables.Count
        dumpBytes = (Get-Item $dumpPath).Length; dumpSha256 = (Get-FileHash $dumpPath -Algorithm SHA256).Hash
        manifestSha256 = $sourceHash; durationSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 2)
        scope = 'Consistent PostgreSQL snapshot, all public table rows, backup bytes; no application login or disaster-site test.'
    }
    $summary | ConvertTo-Json | Set-Content (Join-Path $outputDir 'result.json') -Encoding utf8
    Write-Host "PASS: $($tables.Count) tables match; backup byte hashes and sizes verified."
    Write-Host "Private archive and evidence: $outputDir"
} finally {
    if ($holder) {
        if (-not $holder.HasExited) {
            $holder.StandardInput.Close()
            if (-not $holder.WaitForExit(5000)) { $holder.Kill() }
        }
        $holder.Dispose()
    }
    if ($targetId) {
        $label = & docker inspect --format '{{index .Config.Labels "workout.restore-drill"}}' $targetId
        if ($LASTEXITCODE -eq 0 -and $label -eq $runId) {
            # Only this invocation's ephemeral container, never a Compose container/volume.
            & docker rm -f -v $targetId *> $null
            if ($LASTEXITCODE -ne 0) { Write-Warning 'Temporary drill container cleanup failed; inspect its unique label.' }
        } else { Write-Warning 'Temporary container ownership check failed; no cleanup attempted.' }
    }
}
