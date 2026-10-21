#requires -Version 7.4
param([string]$Payload)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path $PSScriptRoot -Parent
if (-not $Payload) { $Payload = (Get-Content (Join-Path $root '.cache/server-release/current.json') -Raw | ConvertFrom-Json).payload }
$manifest = Get-Content (Join-Path $Payload 'release.json') -Raw | ConvertFrom-Json
$directory = Join-Path $root ('.cache/server-check/' + [guid]::NewGuid().ToString('N'))
$tls = Join-Path $directory 'tls'
New-Item -ItemType Directory -Path $tls | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
$hostname = 'workout.example.test'
$checks = [System.Collections.Generic.List[string]]::new()
$container = 'workout-tls-check-' + [guid]::NewGuid().ToString('N')
$network = $container + '-network'
$started = $false
$networkCreated = $false
$keys = @('WORKOUT_WEB_IMAGE','WORKOUT_SERVER_IMAGE','WORKOUT_DB_IMAGE','WORKOUT_DB_PASSWORD','WORKOUT_DOMAIN','WORKOUT_TLS_DIR','WORKOUT_BIND_ADDRESS','WORKOUT_HTTP_PORT','WORKOUT_HTTPS_PORT','WORKOUT_TRAINING_WRITE_ENABLED','WORKOUT_REGISTRATION_ENABLED','WORKOUT_DEEPSEEK_API_KEY','WORKOUT_DEEPSEEK_MODEL')
$original = @{}
foreach ($key in $keys) { $original[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
function Require([bool]$Condition, [string]$Description) {
    if (-not $Condition) { throw "Server package check failed: $Description" }
    $checks.Add($Description)
}
function Request([string]$Path, [int]$Port, [string]$Scheme = 'https') {
    $id = [guid]::NewGuid().ToString('N')
    $headers = Join-Path $directory "$id.headers"
    $body = Join-Path $directory "$id.body"
    $status = & curl.exe --noproxy '*' --cacert (Join-Path $tls 'fullchain.pem') --resolve "${hostname}:${Port}:127.0.0.1" --silent --show-error --max-time 10 --output $body --dump-header $headers --write-out '%{http_code}' "${Scheme}://${hostname}:${Port}${Path}"
    if ($LASTEXITCODE -ne 0) { throw "HTTP/TLS request failed: $Path" }
    return @{ status = [int]$status; headers = [System.IO.File]::ReadAllText($headers); body = [System.IO.File]::ReadAllText($body) }
}
try {
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$hostname", $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName($hostname)
    $request.CertificateExtensions.Add($san.Build())
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddHours(-1), [DateTimeOffset]::UtcNow.AddDays(30))
    [System.IO.File]::WriteAllText((Join-Path $tls 'fullchain.pem'), $certificate.ExportCertificatePem(), $utf8)
    [System.IO.File]::WriteAllText((Join-Path $tls 'privkey.pem'), $rsa.ExportPkcs8PrivateKeyPem(), $utf8)
    $certificate.Dispose()
    $rsa.Dispose()
    $env:WORKOUT_WEB_IMAGE = @($manifest.imageIds.PSObject.Properties.Name | Where-Object { $_ -like 'workout-web:*' })[0]
    $env:WORKOUT_SERVER_IMAGE = @($manifest.imageIds.PSObject.Properties.Name | Where-Object { $_ -like 'workout-server:*' })[0]
    $env:WORKOUT_DB_IMAGE = @($manifest.imageIds.PSObject.Properties.Name | Where-Object { $_ -like 'workout-postgres:*' })[0]
    $env:WORKOUT_DB_PASSWORD = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
    $env:WORKOUT_DOMAIN = $hostname
    $env:WORKOUT_TLS_DIR = $tls
    foreach ($key in @('WORKOUT_BIND_ADDRESS','WORKOUT_HTTP_PORT','WORKOUT_HTTPS_PORT','WORKOUT_TRAINING_WRITE_ENABLED','WORKOUT_REGISTRATION_ENABLED','WORKOUT_DEEPSEEK_API_KEY','WORKOUT_DEEPSEEK_MODEL')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'Process')
    }
    $emptyEnvironment = Join-Path $directory 'empty-environment.txt'
    [System.IO.File]::WriteAllText($emptyEnvironment, '', $utf8)
    $configText = & docker compose --env-file $emptyEnvironment -f (Join-Path $Payload 'compose.server.yaml') config --format json
    Require ($LASTEXITCODE -eq 0) 'Compose configuration parses with synthetic credentials'
    $config = $configText | ConvertFrom-Json
    Require ($config.services.web.ports.Count -eq 2 -and @($config.services.web.ports | Where-Object host_ip -ne '127.0.0.1').Count -eq 0) 'web ports default to loopback'
    Require (-not $config.services.server.ports -and -not $config.services.db.ports) 'Java and database publish no host ports'
    Require ($config.networks.database.internal -eq $true) 'database network is internal'
    Require ($config.services.server.environment.WORKOUT_COOKIE_SECURE -eq 'true') 'production session cookies require HTTPS'
    Require ($config.services.server.environment.WORKOUT_TRAINING_WRITE_ENABLED -eq 'false' -and $config.services.server.environment.WORKOUT_REGISTRATION_ENABLED -eq 'false') 'training writes and registration default to disabled'
    Require ([string]::IsNullOrEmpty($config.services.server.environment.WORKOUT_DEEPSEEK_API_KEY)) 'no real model credential is supplied'
    foreach ($service in $config.services.PSObject.Properties) {
        Require ($service.Value.pull_policy -eq 'never') "$($service.Name) does not pull images at startup"
        Require ($service.Value.logging.options.'max-size' -eq '10m' -and $service.Value.logging.options.'max-file' -eq '3') "$($service.Name) has bounded logs"
    }
    Require ($config.services.web.read_only -eq $true) 'web root filesystem is read-only'
    & docker network create --driver bridge --label io.github.cgz4526.workout.check=$container $network | Out-Null
    Require ($LASTEXITCODE -eq 0) 'unique web check network created without joining other projects'
    $networkCreated = $true
    $mount = Join-Path $Payload 'nginx/server.conf.template'
    & docker run -d --name $container --label io.github.cgz4526.workout.check=$container --network $network --publish '127.0.0.1::80' --publish '127.0.0.1::443' --read-only --tmpfs /etc/nginx/conf.d --tmpfs /var/cache/nginx --tmpfs /var/run --tmpfs /tmp --mount "type=bind,source=$mount,target=/etc/nginx/templates/default.conf.template,readonly" --mount "type=bind,source=$tls,target=/etc/workout/tls,readonly" --env "WORKOUT_DOMAIN=$hostname" --env 'NGINX_ENVSUBST_FILTER=^WORKOUT_DOMAIN$' $env:WORKOUT_WEB_IMAGE | Out-Null
    Require ($LASTEXITCODE -eq 0) 'release web container starts with synthetic TLS'
    $started = $true
    $running = & docker inspect $container --format '{{.State.Running}}'
    if ($running -ne 'true') {
        & docker logs $container 2>&1 | Set-Content (Join-Path $directory 'web-container.log') -Encoding utf8
        throw "Web check container exited; inspect $directory/web-container.log"
    }
    $httpsPort = [int](& docker inspect $container --format '{{ (index (index .NetworkSettings.Ports "443/tcp") 0).HostPort }}')
    Require ($LASTEXITCODE -eq 0 -and $httpsPort -gt 0) 'HTTPS loopback port is assigned'
    $httpPort = [int](& docker inspect $container --format '{{ (index (index .NetworkSettings.Ports "80/tcp") 0).HostPort }}')
    Require ($LASTEXITCODE -eq 0 -and $httpPort -gt 0) 'HTTP loopback port is assigned'
    & curl.exe --noproxy '*' --cacert (Join-Path $tls 'fullchain.pem') --resolve "${hostname}:${httpsPort}:127.0.0.1" --retry 5 --retry-connrefused --retry-delay 1 --silent --show-error --max-time 10 --output NUL "https://${hostname}:${httpsPort}/healthz"
    Require ($LASTEXITCODE -eq 0) 'HTTPS certificate is trusted via explicit synthetic CA'
    & docker exec $container nginx -t
    Require ($LASTEXITCODE -eq 0) 'generated Nginx configuration passes nginx -t'
    $response = Request '/account-training' $httpsPort
    Require ($response.status -eq 200 -and $response.body -match '<html') 'HTTPS SPA deep link returns HTML'
    $assetMatch = [regex]::Match($response.body, 'src="(/assets/[^"?]+\.js)"')
    Require ($assetMatch.Success) 'release HTML references a built JavaScript asset'
    $asset = Request $assetMatch.Groups[1].Value $httpsPort
    Require ($asset.status -eq 200 -and $asset.headers -match 'immutable') 'built asset has immutable caching'
    $worker = Request '/sw.js' $httpsPort
    Require ($worker.status -eq 200 -and $worker.headers -match 'no-cache') 'service worker is served without immutable caching'
    foreach ($path in @('/assets/absent.js', '/actuator/health', '/.env')) {
        $response = Request $path $httpsPort
        Require ($response.status -eq 404) "protected or missing path returns 404: $path"
    }
    $api = Request '/api/status' $httpsPort
    Require ($api.status -eq 502 -and $api.headers -match 'no-store') 'unavailable backend is a non-cached error, not SPA HTML'
    $redirect = Request '/account-training' $httpPort 'http'
    Require ($redirect.status -eq 301 -and $redirect.headers -match [regex]::Escape("https://$hostname/account-training")) 'HTTP redirects to the configured HTTPS hostname'
    & curl.exe --noproxy '*' --cacert (Join-Path $tls 'fullchain.pem') --resolve "wrong.example.test:${httpsPort}:127.0.0.1" --silent --max-time 10 --output NUL "https://wrong.example.test:${httpsPort}/healthz" 2>$null
    Require ($LASTEXITCODE -eq 60) 'TLS hostname mismatch is rejected'
    @{passed=$true;checks=$checks;releaseId=$manifest.releaseId;directory=$directory;realModelRequests=0;databaseStarted=$false} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $directory 'report.json') -Encoding utf8
    Write-Host "SERVER_PACKAGE_CHECK_PASSED $($checks.Count) $directory"
} finally {
    if ($started) {
        & docker logs $container 2>&1 | Set-Content (Join-Path $directory 'web-container.log') -Encoding utf8
        $owner = & docker inspect $container --format '{{ index .Config.Labels "io.github.cgz4526.workout.check" }}'
        if ($owner -eq $container) { & docker rm -f $container | Out-Null }
    }
    if ($networkCreated) {
        $owner = & docker network inspect $network --format '{{ index .Labels "io.github.cgz4526.workout.check" }}'
        if ($owner -eq $container) { & docker network rm $network | Out-Null }
    }
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $original[$key], 'Process') }
}
