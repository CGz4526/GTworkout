#requires -Version 7.4
param()
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path $PSScriptRoot -Parent
$release = Get-Content (Join-Path $root '.cache/server-release/current.json') -Raw | ConvertFrom-Json
$remote = Get-Content (Join-Path $root '.cache/remote-access/current.json') -Raw | ConvertFrom-Json
if ($remote.host -ne '120.48.174.63' -or $remote.user -ne 'root') { throw 'This staging action is limited to the approved Baidu server.' }
if ($release.releaseId -notmatch '^training-v1-[0-9]{8}-[a-f0-9]{8}$') { throw 'Invalid release ID.' }
if ((Get-FileHash -LiteralPath $release.archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.archiveSha256) { throw 'Release archive checksum changed.' }
$manifest = Get-Content (Join-Path $release.payload 'release.json') -Raw | ConvertFrom-Json
$remoteArchive = "/var/tmp/workout-release-$($release.releaseId).tar"
$remoteDirectory = "/opt/workout/releases/$($release.releaseId)"
$options = @('-i',$remote.keyPath,'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$($remote.knownHostsPath)",'-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=6')
$destination = "$($remote.user)@$($remote.host)"
& ssh @options $destination "test ! -e '$remoteArchive' && test ! -e '$remoteDirectory'"
if ($LASTEXITCODE -ne 0) { throw 'Staging target already exists; nothing will be overwritten.' }
& scp @options $release.archive "${destination}:$remoteArchive"
if ($LASTEXITCODE -ne 0) { throw 'Release transfer failed; partial transfer is retained for review.' }
$script = @'
set -euo pipefail
umask 077
chmod 0600 '__ARCHIVE__'
printf '%s  %s\n' '__ARCHIVE_HASH__' '__ARCHIVE__' | sha256sum -c -
test ! -e '__DIRECTORY__'
install -d -m 0700 /opt/workout/releases
mkdir -m 0700 '__DIRECTORY__'
tar --no-same-owner --no-same-permissions -xf '__ARCHIVE__' -C '__DIRECTORY__'
cd '__DIRECTORY__'
test -z "$(find . -type l -print -quit)"
sha256sum -c SHA256SUMS
for script in start-server.sh reload-server-tls.sh backup-server.sh release-images.sh; do
  bash -n "$script"
done
if bash ./start-server.sh; then
  echo 'Deployment approval guard unexpectedly accepted an unapproved start.' >&2
  exit 1
fi
gzip -dc images.tar.gz | docker image load
__IMAGE_CHECKS__
test -z "$(docker ps -aq --filter label=com.docker.compose.project=workout-prod)"
test -z "$(docker volume ls -q --filter label=com.docker.compose.project=workout-prod)"
echo 'STAGED_ONLY_NO_APPLICATION_OR_DATABASE_STARTED'
'@
$imageChecks = foreach ($property in $manifest.imageIds.PSObject.Properties) {
    if ($property.Name -notmatch '^workout-(server|web|postgres):training-v1-[0-9]{8}-[a-f0-9]{8}$' -or $property.Value -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Unexpected image reference in release manifest.' }
    'test "$(docker image inspect ''{0}'' --format ''{{{{.Id}}}}'')" = ''{1}''' -f $property.Name, $property.Value
}
$script = $script.Replace('__ARCHIVE_HASH__', $release.archiveSha256).Replace('__ARCHIVE__', $remoteArchive).Replace('__DIRECTORY__', $remoteDirectory).Replace('__IMAGE_CHECKS__', ($imageChecks -join "`n")).Replace("`r`n", "`n")
$encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($script))
& ssh @options $destination "printf '%s' '$encoded' | base64 -d | bash -se" 2>&1 | Tee-Object -FilePath (Join-Path $release.directory 'server-stage.log')
if ($LASTEXITCODE -ne 0) { throw 'Staging checks failed; evidence retained and no application start was requested.' }
$report = @{staged=$true;releaseId=$release.releaseId;directory=$remoteDirectory;archiveSha256=$release.archiveSha256;databaseStarted=$false;publicDeployment=$false;imageIds=$manifest.imageIds}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $release.directory 'server-stage.json') -Encoding utf8
$report | ConvertTo-Json -Depth 5
