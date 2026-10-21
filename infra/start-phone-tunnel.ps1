param()
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$preview = Get-Content -LiteralPath (Join-Path $workspace '.cache/phone-preview-current.json') -Raw | ConvertFrom-Json
$origin = [uri]$preview.url
if (!$preview.phoneMode -or $origin.Scheme -ne 'http' -or $origin.Host -ne '127.0.0.1' -or $origin.Port -eq 8088 -or $origin.AbsolutePath -ne '/') {
    throw '只能连接本次登记的独立手机测试入口，禁止连接当前8088或其他服务。'
}
$page = Invoke-WebRequest ($origin.AbsoluteUri)
$status = Invoke-RestMethod ($origin.AbsoluteUri + 'api/status')
if (!$page.Content.Contains('手机验收环境') -or !$status.capabilities.trainingWrites) { throw '目标不是手机隔离验收环境。' }
$binary = Join-Path $workspace '.tools/cloudflared/2026.10.1/cloudflared.exe'
$expected = '4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6'
if (!(Test-Path -LiteralPath $binary) -or (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw '缺少已核验的官方cloudflared便携工具。'
}
$batch = Join-Path $workspace ('.cache/phone-tunnel/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $batch | Out-Null
$stderr = Join-Path $batch 'stderr.log'
$stdout = Join-Path $batch 'stdout.log'
$tunnelProcess = Start-Process -FilePath $binary -ArgumentList @('tunnel','--no-autoupdate','--protocol','http2','--url',$origin.AbsoluteUri) -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$deadline = [DateTimeOffset]::UtcNow.AddHours(2)
$announced = $false
try {
    while (!$tunnelProcess.HasExited -and [DateTimeOffset]::UtcNow -lt $deadline) {
        if (!$announced -and (Test-Path -LiteralPath $stderr)) {
            $logContent = Get-Content -LiteralPath $stderr -Raw
            $match = $null
            if ($logContent) { $match = [regex]::Match($logContent,'https://[a-z0-9-]+\.trycloudflare\.com') }
            if ($match -and $match.Success) {
                @{url=$match.Value;expiresAt=$deadline.ToString('o');origin=$origin.AbsoluteUri;processId=$tunnelProcess.Id;batch=$batch;testOnly=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $batch 'ready.json') -Encoding utf8NoBOM
                @{batch=$batch;url=$match.Value} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspace '.cache/phone-tunnel-current.json') -Encoding utf8NoBOM
                Write-Host ('PHONE_HTTPS_READY '+$match.Value)
                $announced = $true
            }
        }
        if (!$announced -and $tunnelProcess.StartTime.ToUniversalTime().AddMinutes(2) -lt [DateTime]::UtcNow) { throw '两分钟内未建立测试入口，保留日志后停止本次进程。' }
        [void]$tunnelProcess.WaitForExit(1000)
    }
    if (!$announced) { throw ('隧道未建立，脱敏检查本次日志：'+$batch) }
} finally {
    if (!$tunnelProcess.HasExited) { $tunnelProcess.Kill(); [void]$tunnelProcess.WaitForExit(5000) }
    @{closedAt=[DateTimeOffset]::UtcNow.ToString('o');testOnly=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $batch 'closed.json') -Encoding utf8NoBOM
}
