# 本机运行与 Docker 交付

2026-10-19：V5训练迁移获准编写与隔离验证，服务器执行未获批准。包含V5的镜像即使关闭训练写开关，启动后端也会触发Flyway；仅可打包/暂存，不可据此启动服务器项目。实际域名与上线顺序见 `docs/gtworkout-deployment-checklist.md`。

## 百度云主机Docker准备

`bootstrap-docker-ubuntu.sh`用于已明确授权的Ubuntu 24.04 amd64云主机初始化，仅安装官方Docker Engine/Compose及必要下载工具并启用Docker服务。它拒绝自动卸载冲突包，不改已有Docker源或密钥，不创建数据库、部署应用或开放业务端口。签名公钥校验使用`/run/workout-docker-gpg.<唯一批次>/`下仅root可访问的运行时目录，内容仅为公开签名键校验元数据；不自行删除，由系统运行时目录生命周期管理。该脚本会修改APT配置并安装系统级依赖，每个目标执行前必须取得对应授权；已完成安装时仅检查服务和版本。远程接入使用本机项目专用SSH密钥与单独核验的known_hosts，禁止记录私钥或密码。

## 云服务器发布包准备

```powershell
.\infra\prepare-server-release.ps1
.\infra\check-server-package.ps1
.\infra\stage-server-release.ps1
```

这三步分别构建/打包、以合成TLS检查配置、暂存到已授权的百度云主机并导入镜像；不启动项目容器或执行建库迁移。最后一步只接受已登记且指纹核验过的目标，拒绝覆盖同名暂存目录。每次调用构建脚本会创建唯一新版本，已构建且未变更时不要为重复检查重新构建。

`compose.server.yaml`为独立Linux运行配置，`nginx/server.conf.template`直接终止TLS；不覆盖本机配置。`start-server.sh`需要独立数据库批准标志和运行时凭据，默认回环入口、关闭注册/训练写入；公网发布另外批准。`reload-server-tls.sh`只检查/重载已安装证书，不负责签发或自动续期。`backup-server.sh`仅提供手动逻辑备份，不安装定时器，不删除旧归档；列表检查不等于恢复验证。详见[部署审阅](../docs/contracts/server-deployment-review.md)和[服务器运维](../docs/server-operations.md)。

## 账号训练首版隔离预览

iPhone实机准备可加`-PhoneVerification`，使用Secure Cookie和120分钟测试窗口；建立外部HTTPS入口仍需当次授权。步骤见 [手机验收](../docs/phone-verification.md)，不将临时测试入口视为正式上线。

新增 `start-training-preview.ps1` 专用于账号训练首版的隔离演示：自行创建Testcontainers数据库、回环随机入口、空白模型凭据，加载审阅训练SQL，不修改当前workout服务或数据卷。数据库随预览进程结束回收，最长30分钟；仅使用合成数据。默认构建前端并编译测试入口，`-UseBuiltArtifacts`仅用于已经构建的本机验收。不会执行公开部署。

```powershell
.\infra\start-training-preview.ps1
```

启动后根据控制台给出的ready.json读取随机URL，输入STOP结束。正式启用账号训练需要先审阅数据库迁移；当前Compose默认 `WORKOUT_TRAINING_WRITE_ENABLED=false`，不会因重建服务自动启用新写接口。

当前增加 P3 教练任务与计划草案：配置模型后可基于 READY 快照生成计划、确认并添加本地模板。本地训练继续保存在浏览器 IndexedDB，不依赖登录或模型。

## 一键启动

启动 Docker Desktop 的 Linux 容器引擎，然后在项目根目录的 PowerShell 中执行：

```powershell
.\infra\start-local.ps1 -EnableRegistration
```

访问 http://localhost:8088 ，数据备份 → 云服务与连接状态 → 注册自己的账号。用户名 3–32 位英文字母、数字、下划线；密码最少 8 个字符且不超过 72 个 UTF-8 字节。注册后重新输入密码登录。

脚本首次生成随机数据库密码，仅进入当前进程与本项目 Docker 容器配置，不创建 .env、不打印密码。后续启动只读取带有本项目标签的数据库容器配置。若已有数据卷但原数据库容器被移除，则要求注入原密码，不生成新密码重置旧库。建议长期使用时由你从本机密码管理工具注入 WORKOUT_DB_PASSWORD。

- 项目名 workout，专用数据卷 workout_postgres_data。
- Nginx 入口仅绑定 127.0.0.1:8088；Java、PostgreSQL 不发布宿主端口。
- 数据库原始备份最大 20 MiB/份、20 份/用户、200 MiB/用户。默认最多 10 个账号，无删除或自动清理接口。
- 注册默认关闭，-EnableRegistration 仅为本机演示显式开启。退出云账号不会删除本地记录。
- 上传前选择已导出的 JSON，核对账号、计数及训练日期时区，勾选确认后上传。重试同一文件复用请求标识；下载文件不会自动导入或覆盖本地库。
- 新备份自动创建持久任务；处理完成后点击“查看快照分析”。旧备份先点击“生成快照分析”，不会因升级而自动解析。失败时原文件仍可下载，并支持有界重试。
- 云端按指定快照展示覆盖日期、训练次数/天数、容量、体重与动作趋势。它不会自动反映继续训练后的本地数据；旧统计页的部位“天数”口径差异在云端明确说明。
- 切换浏览器或从旧站点切换至 localhost:8088 属于 origin 迁移，先从旧站点导出本地 JSON，保留副本再通过现有导入功能恢复。

三服务构建：Node 构建 PWA；Maven package 运行单元测试后打包；Java 以非 root 身份运行。真实数据库集成测试属于 Maven verify 阶段，在宿主机通过 Testcontainers 执行，不向镜像构建过程开放 Docker socket。全部基础镜像固定摘要，Maven 仓库只使用官方 Central，下载使用构建缓存。

Nginx 独立启动，不等待 Java；readiness 包含数据库依赖，liveness 只判断应用进程。模型未配置不影响 P1。Actuator 不通过 Nginx 暴露；API 不进入 PWA 离线缓存。

## DeepSeek 模型配置

用户选定模型标识 deepseek-v4-flash。官方已将该兼容标识路由至 V4.1 Flash，详见 [工程决策](../docs/adr/0004-bounded-coach-agent.md)。密钥只通过环境注入，不保存 .env；可在自己的 PowerShell 中隐藏输入：

```powershell
$modelSecret = Read-Host 'DeepSeek API key' -AsSecureString
try {
  $env:WORKOUT_DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new('', $modelSecret).Password
  $env:WORKOUT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
  .\infra\start-local.ps1 -EnableRegistration
} finally {
  $env:WORKOUT_DEEPSEEK_API_KEY = $null
  $modelSecret.Dispose()
}
```

凭据会进入本项目 server 容器的运行时环境，宿主 Docker 管理员可读取；不会写进镜像、源码或普通日志。重新执行启动脚本时必须再次提供模型环境变量，否则新容器的 Agent 会显示未配置。不要打印 docker inspect 的完整环境输出或分享 Compose 展开的凭据。

页面入口：云服务 → 查看快照分析 → 教练计划草案。填写最多 90 天的复盘日期、下周天数/时长，选择最多 30 个允许动作，确认向 DeepSeek 发送必要数据后生成。只发送所选动作名称和必要统计/记录标识，不发送照片、备注和完整备份。生成是付费行为，单任务最多 4 次模型请求；失败不自动重试付费调用。

复制任务编号后，刷新页面可以再次获取任务与草案。确认仅改变云端草案状态；本地应用是另一事务，重复应用保留已有模板的编辑。若本浏览器没有快照中的动作 ID，则拒绝整批新增，不自动导入动作或历史数据。

## 仅更新前端

已有三服务运行时，可以执行：

```powershell
.\infra\rebuild-web.ps1
```

该脚本只构建/替换 web，并验证 server/db 容器 ID 不变；数据库密码仅在进程内复用并于结束恢复原环境，不读取模型密钥。适合只改前端时保留运行中的后端配置。浏览器 PWA 是否已加载新版本仍需实际确认，不能由容器健康状态推断。

## 不访问用户数据的 Web 检查

```powershell
.\infra\check-web.ps1
```

使用本机已构建的 workout-web:p3 镜像，在无网络、无宿主端口、无卷的临时容器里验证 Nginx 语法和 10 项响应规则；只回收本次容器。结果写 .cache/web-check-<UUID>.json，不访问浏览器、Java 或数据库。它不能代替实际 PWA 更新和离线验收。

复核上一批真实合成模型样本可运行 `node tests/contracts/review-assistant-samples.mjs`，需要已保留的 .cache 原始报告；不会自动调用模型。结果只代表结构约束与描述性指标，详见 [样本审阅](../docs/verification/2026-10-16-assistant-sample-review.md)。

## 当前镜像的空环境启动演练

```powershell
.\infra\fresh-deployment-drill.ps1
```

在唯一 Compose 项目中使用本机现有三服务镜像与临时内存数据库，移除所有宿主端口和数据卷，显式禁用模型。验证新库迁移、健康状态和同源 API 后只回收本次容器/网络。需要 PowerShell 7.4+、本机镜像和支持 `!reset` 的 Compose；本次使用 Compose 5.1.3。不下载镜像、不修改当前 workout 服务，不等于新电脑从源码全新构建或浏览器验收。

配置和脱敏结果保留在 .cache/workout-fresh-<UUID>/。随机凭据不写文件；展开后的 Compose 配置不得打印或保存。实际记录见 [空环境部署](../docs/verification/2026-10-16-fresh-deployment.md)。

## 检查与停止

在执行启动脚本的同一个 PowerShell 会话中，运行：

```powershell
docker compose -f infra/compose.yaml ps
docker compose -f infra/compose.yaml logs --tail 100 server
docker compose -f infra/compose.yaml stop
```

换终端后若未注入数据库密码，可用不读取 Compose 环境配置的命令检查：

```powershell
docker ps -a --filter label=com.docker.compose.project=workout
docker logs --tail 100 workout-server-1
```

日常停止使用 stop，下一次重新运行启动脚本。不要用删除卷的方式排错，也不要随意移除唯一保存生成密码的数据库容器。

## 构建与测试

```powershell
npm ci
npm run build
npm run lint
npm run test:contracts
npm run test:agent-plan
npm run test:cloud-session
$env:JAVA_HOME='C:\Program Files\Java\jdk-17'
$env:MAVEN_USER_HOME="$PWD\.cache\maven"
cd server
.\mvnw.cmd verify
```

verify 自动创建全新的 Testcontainers PostgreSQL 17，执行 Flyway 和集成测试，不读取开发数据卷。Docker 不可用时集成测试必须失败，不能按跳过视为通过。package 运行单元测试并打包；它不能替代 verify。Windows 下不要在运行 target JAR 的同时重新打包。

前端开发可在三服务启动后运行 npm run dev，Vite 默认将 /api 转发 localhost:8088。若另行在宿主机运行 Java，可通过进程变量 WORKOUT_API_TARGET 指定地址；Java 的 WORKOUT_DB_URL/USER/PASSWORD 必须指向你明确选择的本项目开发数据库，不连接其他项目数据库。默认 Compose 不开放数据库端口。

## 合成数据冒烟

PowerShell 7 中运行：

```powershell
.\infra\smoke-test.ps1
```

脚本只允许 localhost:8088，创建一套新的合成账号/备份，验证登录、上传重放、投影 READY、统计和下载摘要；随后只重启本项目 db/server，验证 JDBC 会话、文件和投影保留，最后退出。不会删除任何数据；会留下一个合成账号和一份文件，占用测试环境名额。不要把它作为无限重复的健康探针。

verify 中的 P2ProcessRecoveryIT 仅启动自己的测试数据库与 Java 进程，强杀已领取任务的测试进程后验证真实租约恢复，不停止当前应用。完整 verify 约需一分钟以上，不能用只跑 package 代替。具体环境与结果见 docs/verification/2026-10-16-p2.md。

容器重启测试不等于数据库备份恢复。数据库隔离恢复已单独验证，见下方；特定后端 P3→P2→P3 回退已在独立合成库验证，完整前后端回退尚未验证。没有修改 CI/CD、系统配置或公开部署。

## 数据库隔离恢复演练

PowerShell 7.4+ 中运行：

```powershell
.\infra\restore-drill.ps1
```

脚本只读导出唯一运行中的 workout 数据库，在全新、无网络/端口的临时 PostgreSQL 恢复，比较同一快照的全部公共表数据摘要，并检查备份原字节的 SHA-256 和长度。不接受已有恢复目标，不覆盖当前库，不停止当前服务，不操作浏览器数据。只按本次唯一标签回收临时容器，不删除现有卷。

归档和私有核对清单保存在忽略目录 .cache/recovery/<唯一批次>/，不会自动清理。归档未加密，含账号、会话和备份数据，不可提交或公开；建议由你另行保存到受保护的备份位置。临时库限制 1 GiB 数据、256 MiB 内存，源快照最多持有 10 分钟；超限会失败，不能把失败当作通过。

此脚本验证数据库恢复，不包含恢复后应用登录/下载、异地副本或版本回退；应用冷恢复和特定后端回退已由独立 P4 探针验证，见 [P4 验证](../docs/verification/2026-10-16-p4.md)。实际结果见 [恢复验证记录](../docs/verification/2026-10-16-recovery.md)。
