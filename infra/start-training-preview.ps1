param([switch]$UseBuiltArtifacts, [switch]$PhoneVerification)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$oldJava = $env:JAVA_HOME
$oldMaven = $env:MAVEN_USER_HOME
try {
    if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Java\jdk-17' }
    $java = Join-Path $env:JAVA_HOME 'bin/java.exe'
    if (-not (Test-Path -LiteralPath $java)) { throw '请先为当前终端配置 Java 17 JAVA_HOME；脚本不安装工具。' }
    $env:MAVEN_USER_HOME = Join-Path $workspace '.cache/maven'
    Push-Location $workspace
    try {
        if (-not $UseBuiltArtifacts) {
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
        }
    } finally { Pop-Location }
    Push-Location (Join-Path $workspace 'server')
    try {
        if (-not $UseBuiltArtifacts) {
            & .\mvnw.cmd '-Dmaven.repo.local=../.cache/m2' -B test-compile dependency:build-classpath '-Dmdep.outputFile=target/test-classpath.txt'
            if ($LASTEXITCODE -ne 0) { throw '隔离预览入口编译失败。' }
        }
        if (-not (Test-Path -LiteralPath 'target/test-classpath.txt')) { throw '缺少已构建依赖，请去掉 UseBuiltArtifacts 重试。' }
        $previewClasspath = 'target/test-classes;target/classes;' + (Get-Content -LiteralPath 'target/test-classpath.txt' -Raw).Trim()
        $previewArguments = @('--training-v1')
        if ($PhoneVerification) {
            $previewArguments += '--phone-verification'
            Write-Host '手机验收准备：仅回环监听、Secure Cookie，需单独批准HTTPS访问入口；最长120分钟。'
        }
        Write-Host '隔离预览仅供合成数据验收；当前 8088 和原数据库不变。输入 STOP 结束。'
        & $java -cp $previewClasspath io.github.cgz4526.workout.assistant.BrowserAcceptanceEnvironment @previewArguments
        if ($LASTEXITCODE -ne 0) { throw '隔离预览异常结束，请查看本次验收目录。' }
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $oldJava
    $env:MAVEN_USER_HOME = $oldMaven
}
