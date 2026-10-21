#requires -Version 7.4
param(
    [ValidatePattern('^training-v1-[0-9]{8}-[a-f0-9]{8}$')]
    [string]$ReleaseId = ('training-v1-' + (Get-Date -Format yyyyMMdd) + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path $PSScriptRoot -Parent
$directory = Join-Path $root ".cache/server-release/$ReleaseId"
if (Test-Path -LiteralPath $directory) { throw 'Release directory already exists; nothing will be overwritten.' }
$payload = Join-Path $directory 'payload'
New-Item -ItemType Directory -Path $payload | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payload 'nginx'), (Join-Path $payload 'review') | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)

function RequireNative([string]$Action) {
    if ($LASTEXITCODE -ne 0) { throw "$Action failed. Evidence and partial files are retained at $directory" }
}
function CopyText([string]$Source, [string]$Destination) {
    $contents = [System.IO.File]::ReadAllText($Source).Replace("`r`n", "`n")
    [System.IO.File]::WriteAllText($Destination, $contents, $utf8)
}

$serverImage = "workout-server:$ReleaseId"
$webImage = "workout-web:$ReleaseId"
$dbImage = "workout-postgres:$ReleaseId"
$dbSource = 'postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'

& docker build --file (Join-Path $PSScriptRoot 'docker/server.Dockerfile') --tag $serverImage $root
RequireNative 'Server image build'
& docker build --file (Join-Path $PSScriptRoot 'docker/web.Dockerfile') --tag $webImage $root
RequireNative 'Web image build'
& docker image inspect $dbSource --format '{{.Id}}' | Out-Null
RequireNative 'Reviewed local PostgreSQL source lookup'
& docker tag $dbSource $dbImage
RequireNative 'Release-specific PostgreSQL tag'

$imageIds = [ordered]@{}
foreach ($tag in @($serverImage, $webImage, $dbImage)) {
    $imageIds[$tag] = (& docker image inspect $tag --format '{{.Id}}').Trim()
    RequireNative "Image ID lookup: $tag"
}
foreach ($file in @('compose.server.yaml', 'start-server.sh', 'reload-server-tls.sh', 'backup-server.sh')) {
    CopyText (Join-Path $PSScriptRoot $file) (Join-Path $payload $file)
}
CopyText (Join-Path $PSScriptRoot 'nginx/server.conf.template') (Join-Path $payload 'nginx/server.conf.template')
CopyText (Join-Path $root 'docs/contracts/r2-training-schema.sql') (Join-Path $payload 'review/training-v1.sql')
CopyText (Join-Path $root 'docs/contracts/server-deployment-review.md') (Join-Path $payload 'review/deployment-review.md')
$releaseVariables = @(
    '# Non-secret release image references; never add passwords or tokens here.'
    "export WORKOUT_SERVER_IMAGE='$serverImage'"
    "export WORKOUT_WEB_IMAGE='$webImage'"
    "export WORKOUT_DB_IMAGE='$dbImage'"
) -join "`n"
[System.IO.File]::WriteAllText((Join-Path $payload 'release-images.sh'), $releaseVariables + "`n", $utf8)

$rawArchive = Join-Path $directory 'images.raw.tar'
$compressedArchive = Join-Path $payload 'images.tar.gz'
& docker image save --output $rawArchive $serverImage $webImage $dbImage
RequireNative 'Release image export'
$inputStream = [System.IO.File]::OpenRead($rawArchive)
$outputStream = [System.IO.File]::Create($compressedArchive)
$gzip = [System.IO.Compression.GZipStream]::new($outputStream, [System.IO.Compression.CompressionLevel]::Fastest, $true)
try { $inputStream.CopyTo($gzip) } finally { $gzip.Dispose(); $inputStream.Dispose(); $outputStream.Dispose() }

$manifest = [ordered]@{
    releaseId = $ReleaseId
    createdAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    imageIds = $imageIds
    postgresSource = $dbSource
    schemaStatus = 'V5_INCLUDED_SERVER_EXECUTION_NOT_APPROVED'
    productionStarted = $false
    containsCredentials = $false
    realModelRequests = 0
}
[System.IO.File]::WriteAllText((Join-Path $payload 'release.json'), ($manifest | ConvertTo-Json -Depth 5), $utf8)
$hashLines = foreach ($file in Get-ChildItem -LiteralPath $payload -File -Recurse | Sort-Object FullName) {
    $relative = [System.IO.Path]::GetRelativePath($payload, $file.FullName).Replace('\', '/')
    "{0}  {1}" -f (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
}
[System.IO.File]::WriteAllText((Join-Path $payload 'SHA256SUMS'), ($hashLines -join "`n") + "`n", $utf8)
$archive = Join-Path $directory "$ReleaseId.tar"
& tar -cf $archive -C $payload .
RequireNative 'Release package archive'
$summary = [ordered]@{
    releaseId = $ReleaseId
    directory = $directory
    payload = $payload
    archive = $archive
    archiveBytes = (Get-Item -LiteralPath $archive).Length
    archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
}
[System.IO.File]::WriteAllText((Join-Path $root '.cache/server-release/current.json'), ($summary | ConvertTo-Json), $utf8)
$summary | ConvertTo-Json
