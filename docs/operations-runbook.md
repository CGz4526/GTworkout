# 本机运维与演练手册

范围：单机 Docker 演示环境。真实数据的恢复切换、凭据修改和公开部署仍按 AGENTS.md 单独确认；本手册不自动授权生产切换。

## 日常检查

```powershell
docker ps --filter label=com.docker.compose.project=workout
Invoke-RestMethod http://localhost:8088/api/status
docker logs --tail 100 workout-server-1
```

三服务应 healthy；模型是否配置由 assistant 能力表示，不是数据库健康的替代指标。不要分享完整 docker inspect/Compose 环境输出。普通停止用 [运行说明](../infra/README.md) 中的 stop；不以删除卷排错。

## 备份与恢复的两条路径

- 浏览器 IndexedDB：使用已有 JSON 导出，切换电脑/浏览器/origin 前保留副本。服务端数据库归档不包含尚未上传的本地记录。
- 服务端 PostgreSQL：`infra/restore-drill.ps1` 对当前项目库执行只读一致性导出，并恢复到新临时库比较数据。归档存 .cache/recovery/，含敏感数据且未加密，不能公开或提交。

当前库实际切换到恢复库前，应检查归档摘要、数据库/应用版本、原始下载、投影、账号与草案，保存原实例和原凭据，明确回切路径。先在新库演练，不向唯一源库覆盖恢复。不运行 clean/repair、删卷或无审阅的降级迁移。

## 可重复执行的工程验证

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:MAVEN_USER_HOME = "$PWD\.cache\maven"
Set-Location server
.\mvnw.cmd '-Dmaven.repo.local=../.cache/m2' -B verify
```

verify 需要 Docker。P4RecoveryIT 自动创建合成源/目标库，验证新库新 JVM 的冷恢复；P2ProcessRecoveryIT 仍验证强杀与租约恢复。它们不连接当前项目库，测试 JVM 不继承真实模型配置。归档/进程日志留在 target/，清理前确认。

## 显式负载探针

在 server/ 中，先完成 verify，确保 target JAR 是当前代码，再执行：

```powershell
.\mvnw.cmd '-Dmaven.repo.local=../.cache/m2' -B test-compile dependency:build-classpath '-Dmdep.outputFile=target/test-classpath.txt'
$probeClasspath = 'target/test-classes;target/classes;' + (Get-Content target/test-classpath.txt -Raw).Trim()
& "$env:JAVA_HOME\bin\java.exe" -cp $probeClasspath io.github.cgz4526.workout.P4LoadProbe
```

探针固定三个合成规模、最大并发 8，每档 64 请求，不是向当前 localhost:8088 压测。结果在 target/p4-load-<UUID>/，控制台会显示目录；比较不同版本必须保持环境、数据、预热和采样方式一致，不能只比较单次最好值。

## 后端版本回退探针

需保留本机历史 P2 JAR，不能假设新环境天然有旧镜像。此次从本机 workout-server:p2 只读提取，校验来源与摘要后，在自己的测试库中执行：

```powershell
& "$env:JAVA_HOME\bin\java.exe" -cp $probeClasspath io.github.cgz4526.workout.P4RollbackProbe 'D:\CCDevelop\workout-master\.cache\p4-historical-p2.jar'
```

这只演练特定 P3→P2→P3 后端组合和保留 V4 schema，不降级数据库，不切换正在使用的服务。若旧版不能启动，应保留诊断并明确该组合不支持回退，不能跳过 Flyway 校验使其通过。完整前后端回退仍需另外验收。

## 模型故障

教练任务超时、提供商错误或结果校验失败不会影响本地训练和云备份。先查看稳定错误码与任务编号，不将完整提示/照片/备份复制到日志。未知结果的模型调用不会自动重放；新建任务可能再次计费，需要用户明确选择。

首批 10 次真实请求已耗尽；本轮新增 30 次独立预算使用 29 次，剩余 1 次保留，两个计数文件均不能重置继续调用。普通 verify、冷恢复、负载和回退探针不需要真实模型。详情见 [Agent 评测](verification/2026-10-16-assistant-evaluation.md)；更大真实评测须先明确新增预算和数据范围。

实际结果见 [P4 验证](verification/2026-10-16-p4.md)，人工演示见 [演示与简历证据](demo-guide.md)。


## 隔离页面验收

`BrowserAcceptanceEnvironment` 为显式测试入口，仅代理自己的回环 Java 服务，使用 Testcontainers PostgreSQL 和模拟模型，不连接当前项目数据库。运行、暂停自身入口和回收方法见 [隔离闭环记录](verification/2026-10-16-isolated-browser-closure.md)。不把其中任务号用于当前 8088 服务，不注入真实模型凭据。
