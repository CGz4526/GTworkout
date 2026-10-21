# Workout 项目协作规范

## 项目定位与当前状态

- 新阶段入口：`docs/server-managed-training-plan.md`；用户已要求推进实现，并单独批准隔离测试库新增表与独立账号缓存。首版交接见 `docs/training-v1-handoff.md`，不把剩余设计视为已实现；当前运行库、旧WorkoutDB及正式发布仍不在本轮切换范围。
- R1 细化稿位于 `docs/contracts/r1-training-api.md`、`r1-training-migration-review.md`、`r1-local-sync.md`。SQL 仅作为 Markdown 审阅片段，不放入自动扫描目录；本轮继续授权覆盖方案细化，不执行迁移。
- R2 `server/src/main/java/io/github/cgz4526/workout/workouts/` 存训练写模型输入、控制器、聚合事务与导入；测试按同名包及现有根级IT组织。该目录不与既有快照 `training/` 混用。
- R2后续用户已单独批准隔离测试库新增训练表及独立账号IndexedDB；当前运行开发库不迁移。`docs/contracts/r2-training-schema.sql` 是可执行审阅SQL，仅由专用隔离验收入口显式加载，不在Flyway目录自动应用。`src/data/` 管账号缓存和仓储，`src/sync/` 管持久队列；新缓存使用独立库，不改变WorkoutDB四表及迁移。运行证据留忽略目录，目录不定期自动清理。
- 手机验收准备沿用独立测试库；BrowserAcceptanceEnvironment的`--phone-verification`只允许训练首版模式，使用Secure测试Cookie、页面测试标识和最长120分钟生命周期。临时HTTPS隧道需单独确认外部访问范围后才能启动；不修改防火墙、系统证书或现有站点。`.tools/cloudflared/<发布版本>/`仅存官方校验的便携工具，不安装服务或修改PATH，清理仍需确认。`docs/phone-verification.md`保存实机步骤，测试结果不能以桌面窄屏替代。
- 用户已批准本次独立环境最长两小时的Cloudflare随机HTTPS入口，仅合成数据；手机为iPhone/iOS。`infra/start-phone-tunnel.ps1`只连接phone-preview-current.json登记且带测试标识的回环入口，凭进程句柄管理本次cloudflared，不暴露8088或其他服务，不修改真实站点。证据写`.cache/phone-tunnel/<唯一批次>/`，不记录用户真实密码或训练内容。

- 当前已实现：React + TypeScript 本地优先 PWA，Java 会话账号、版本化云备份、持久任务、只读训练投影与查询，以及 DeepSeek 教练任务、草案确认与本地模板应用。本地训练数据仍保存在浏览器 IndexedDB。
- 后续目标：保持现有训练体验，增加 Java 后端、版本化云备份、训练分析与教练 Agent，作为后端简历项目。
- 实施方案入口：`docs/backend-implementation-plan.md`。方案中的模块、接口与表结构均是设计，不能视为已经实现。
- 现有前端细节及历史约定见 `CLAUDE.md`；其部署说明不能替代用户对正式发布的单独授权。

## 约束先行

- 新目录先在本文件或其目录规范中说明用途、命名和清理规则，再新增实现。
- 大改动先出方案并由用户确认；结构变化先改文档，再改代码。
- 保留用户已有未提交修改，不覆盖、不回滚。本轮开始前已有 `CLAUDE.md`、`src/db/index.ts` 修改。
- 默认中文沟通，代码、命令及标识符使用英文。

## 必须单独确认的操作

- 2026-10-19用户单独批准：将训练五表整理为Flyway V5并在隔离PostgreSQL验证；服务器执行仍需另确认。V1–V4不变，隔离验收和手机预览改用正式迁移，不再重复手动加载审阅SQL。此后发布包携带V5，未经服务器迁移批准不得启动该包的后端，即使训练写开关关闭也会触发Flyway。

- 删除文件、目录或 Git 历史。
- 修改 `.env`、密钥、token、CI/CD 配置。
- 数据库 schema 变更或数据迁移，包括执行新服务的建表迁移。
- `git push`、`git rebase`、`git reset --hard`、强制推送。
- 安装全局依赖、修改系统配置、安装 Docker 等系统级软件。
- 正式公开部署或发布。
- 方案批准不自动替代上述操作的具体批准。先提供可审阅的设计与影响范围，再请求对应操作授权。

## 目录与命名

- 2026-10-21用户明确要求将本机工程上传为独立GitHub仓库`CGz4526/GTworkout`，保留原`workout`纯前端仓库不动。本次范围为源码审阅、本地Git初始化与提交、创建新仓库及首次推送；不部署站点，不执行数据库迁移，不修改CI/CD或凭据。发布排除缓存、工具、依赖、构建产物、真实备份及密钥；上传审阅和脱敏证据放`.cache/github-publication/<唯一批次>/`，不自动清理。GitHub登录由用户在官方交互中完成，不在聊天或文件中收集token。

- 百度云远程接入：用户已单独批准安装Docker/Compose及创建本项目专用SSH密钥。专用私钥保留本机用户的`.ssh/`目录，使用唯一文件名并限制访问权限，不复制到仓库或服务器；服务器仅添加公钥。`.cache/remote-access/`保存已核验的主机公钥、连接元信息及脱敏执行证据，不记录密码、私钥或真实业务数据。主机指纹以用户从云终端提供的值为准；数据库迁移、正式发布及其他系统变更仍需对应授权，文件清理需确认。
- 百度云部署准备：`infra/compose.server.yaml`、`infra/nginx/server.conf.template`和`infra/*-server*.sh/ps1`管理单机发布包、TLS配置与备份操作；不替换现有本机Compose或Nginx配置。`.cache/server-release/<唯一版本>/`保存不含凭据的配置、镜像归档和摘要；`.cache/server-check/<唯一批次>/`保存合成TLS证书及隔离配置检查证据，证书不安装到系统信任库。服务器只暂存文件/导入镜像，不运行项目容器；暂存路径为`/opt/workout/releases/<唯一版本>/`，业务数据库、TLS私钥和备份分别规划在专用卷、`/opt/workout/tls/`、`/opt/workout/backups/<唯一批次>/`，本轮不创建后三类真实数据。`docs/contracts/server-deployment-review.md`是迁移/运行配置审阅入口；SQL保留审阅状态，不放Flyway扫描目录，不因打包而执行。公开绑定、生产凭据、建表与定时任务仍须单独批准。
- 前端重设计先交付`docs/frontend-redesign-plan.md`与本会话可写visualizations目录中的交互原型，获用户确认后再替换正式页面。原型仅合成数据、内存交互，不访问API、IndexedDB或真实账号；`.cache/ui-review/<唯一批次>/`保存原型渲染与检查证据，不自动清理。不因UI改造调整数据schema、统计语义或生产部署，未实现能力不得画成已可用功能。
- 2026-10-17用户明确要求“现在开始写代码”，授权按精简方案替换正式React表现层。`src/components/DailyWeight.tsx`管理本机每日体重交互，`src/lib/workoutPresets.ts`定义六部位预设及显式添加，只有用户开始或编辑预设时才新增本机模板/缺失动作，不自动播种、不覆盖用户模板；沿用现有四表、日期、归一化与训练保存入口。未授权的统计口径调整保留原定义，数据库、凭据、生产发布仍按红线处理。
- 2026-10-17后续修订：用户要求用原“我的模板”替代自动部位预设、先预览编辑再开始、统一模板工作组为1并支持热身组。首页不再调用workoutPresets；旧实验模板保留在管理页不删除。`src/lib/templateWorkout.ts`管理模板配置编辑和事务启动；TemplateItem可选warmupSets只用于现有JSON条目，0–10、缺省0，不改Dexie schema或备份版本，不改既有sanitizeItem语义。用户明确授权将本机模板defaultSets统一为1的正常配置编辑，通过显式页面按钮执行一次，不在启动时自动迁移，不改变训练历史和正在进行的训练。测试使用独立origin和合成记录。
- 2026-10-17训练录入修订覆盖上条热身缺省值：新展开动作warmupSets缺省1、显式0仍可不热身，不自动修改历史或已展开的训练。`src/lib/workoutEntry.ts`保存纯函数：热身前置增删、同动作空白后续组继承重量、按动作名确定重量输入初始模式。NumberWheel仅对命中的训练重量使用键盘优先，次数/RPE/休息保持既有模式；不增加schema或训练字段。验证使用独立合成环境，用户正在训练的页面不刷新、不自动补组。

| 路径 | 用途与约定 |
|---|---|
| `src/` | 现有前端。页面用 PascalCase；工具与客户端用 camelCase。新后端请求集中在 `src/api/`。 |
| `public/` | 随前端发布的公开资源，禁止存放备份、凭据或测试数据。 |
| `docs/` | 架构、实施计划、接口与验收说明；文件名用 kebab-case。保留有效设计，废弃设计先标注状态，删除需确认。 |
| `server/` | Maven Java 工程，根包 `io.github.cgz4526.workout`，按业务模块组织；完整验证运行 Maven Wrapper verify。 |
| `infra/` | Docker、反向代理和本机运行脚本，不存放真实凭据；职责见 infra/README.md。 |
| `tests/`（按需创建） | 新增跨端契约与端到端用例；夹具只用合成数据，不复制用户真实备份。 |
| `.workbuddy-ai/` | 已有本地回归、截图和工作资料，沿用现有结构；禁止批量扫描浏览器 profile 或输出敏感内容。 |

- 不创建无业务实现的空模块或占位接口。
- 构建产物、下载的工具、临时文件和运行数据须忽略提交，清理前确认；不在 `public/` 或 `docs/` 下堆放临时产物。
- 不新增真实 `.env` 文件。运行时凭据由用户通过环境变量或部署环境注入。

## 数据与兼容性

- 2026-10-19用户要求注入近期模拟训练以预览效果：仅在独立回环端口5209的演示origin写入合成记录，5197不操作。`.cache/ui-review/recent-demo-20261019/`存演示HTML入口、数据夹具与启动证据，页面入口先检查训练/体重为空后用新增事务装载，不clear/put已有记录；训练与模板名称统一标注“演示”。入口不进入src/public或生产构建，数据留本机，不自动清理。使用完成仍按现有删除红线处理。

- 2026-10-19用户要求重新设计训练频率展示：`src/lib/trainingFrequency.ts`按本地日期汇总最近六个自然周的训练天数，区分仅力量、仅有氧、同日两者都有，日内去重；本周仅截至今天，完整周均值不混入本周。仅替换频率卡，不改变体重、容量或其他既有统计规则；`tests/contracts/check-training-frequency.mjs`用合成边界数据验证，无数据库写入。

- 训练计时、逐组记录、本地保存不依赖后端与模型服务。
- 第一版不做多设备双向同步，不由后端自动覆盖本地库。
- 不修改现有备份格式、Dexie schema、归一化逻辑或统计口径，除非单独说明、获批并完成相应验证。
- 本地日期统一使用 `src/lib/date.ts`；每日体重以 `weights` 为准，`session.weight` 保留兼容用途。
- 有效组与容量统一使用 `src/lib/set.ts` 的语义。Java 实现必须用共享夹具验证一致性。
- 历史快照保持不可变；查询用户身份来自服务端认证上下文，不信任客户端或模型传入的用户 ID。
- 凭据、密码、训练照片、完整备份和模型完整上下文不进入代码、提交或普通日志。

## 验证规则

- 纯文档变更：检查内容、链接、格式和 diff，无需构建或浏览器回归。
- 前端类型或逻辑变更：运行 TypeScript 检查，并按 `CLAUDE.md` 跑受影响的回归组；布局变更还需实际查看页面。
- Dexie 迁移、备份导入导出、归一化边界变更：先说明数据风险，按 `CLAUDE.md` 约定获用户确认后运行全量回归。
- 后端实现后：使用 Maven Wrapper 的 `verify`；涉及 SQL 时用真实 PostgreSQL 集成测试，不能以 H2 替代兼容性验证。
- Docker 环境不可用时只能报告静态配置检查，不能宣称容器启动验证通过。
- 不通过忽略测试、注释错误、默认返回假成功等方式通过验证。

## 实施边界

- 当前授权覆盖 P0–P3 工程及本项目专用库的兼容新增迁移、隔离测试库；不得覆盖现有备份或浏览器数据。
- 下一阶段按实施方案逐段确认完成标准；数据库、凭据配置、系统安装及发布仍遵守上方红线。

## 2026-10-16 P0 实施补充（覆盖旧阶段状态）
用户已批准开始 P0，版本以本机为准：Java 17、Spring Boot 4.0.8、Maven Wrapper 3.9.9。server/ 为后端，验证 .\mvnw.cmd verify；target/ 忽略。infra/docker/ 存构建文件，infra/nginx/ 存代理配置。docs/adr/ 用 NNNN-topic.md，docs/contracts/ 存设计，docs/verification/ 用 YYYY-MM-DD-topic.md 保存验证。src/api/ 为同源客户端。新目录按阶段创建，无空模块。 .tools/、.cache/ 为忽略的工具与缓存，清理需确认。数据库和其他红线仍需单独批准。

## P1 准备阶段

- 用户已要求继续推进；数据库操作获批前只提交设计与不访问数据库的输入规则。
- server/src/main/java/io/github/cgz4526/workout/identity/ 存账号规则，backup/ 存上传校验与备份规则；对应测试按同名业务包组织。
- docs/contracts/p1-migration-review.md 存具体 SQL 审阅稿，不放入 Flyway 自动扫描目录；未批准不得复制为可执行迁移或连接数据库执行。
- docs/contracts/p1-api.md 存账号、文件上传、错误、配额与会话契约。后续实现遵循该契约，偏差先改文档。

## P1 落地授权与结构

- 用户明确授权：只要不影响现有数据即可直接执行。允许本项目新建库与隔离测试库初始化、Flyway 迁移；其他已有库及 IndexedDB 保持隔离。
- server/src/main/resources/db/migration/ 按 V{N}__{snake_case}.sql 命名；已应用版本不可修改，不提供 clean/repair/删除数据脚本。
- identity/、backup/ 内按 controller/service/mapper/model 实际职责组织，不建立空接口层；MyBatis SQL 使用参数绑定，资源查询必带 user_id。
- server/src/test/ 的 SQL/会话/并发测试使用 Testcontainers PostgreSQL，与开发数据卷不共享；容器由框架按测试生命周期回收，不执行清理现有容器或卷的命令。
- infra/ 下的本地启动脚本仅在进程环境生成新项目数据库凭据，不回显、不写 .env；已有数据卷必须由用户提供原凭据，禁止自动重置。

## P2 执行范围

- 用户已要求测试通过后继续，沿用“不影响现有数据即可直接执行”的授权。按既定 P2 方案新增持久任务、只读训练投影与查询，不覆盖本地历史或原始备份。
- jobs/ 存任务状态、租约、领取与有界执行器；training/ 存投影构建、统计和 API。jobs 只调用 JobHandler，不依赖训练实现；controller 不直接使用 Mapper。
- V3 只新增任务/投影表并扩展备份状态约束，保留所有已有备份字节；旧备份由用户明确发起分析，不自动转换。
- docs/contracts/p2-processing.md 是状态机和统计契约；server/src/test/resources/contracts/ 存合成共享夹具；tests/contracts/ 存 TypeScript 参考检查。夹具不含真实数据，构建产物留在忽略目录。
- P2 复验使用 Wrapper verify、npm run build/lint、跨端夹具检查与本项目 Docker 冒烟；不操作其他库、容器或卷。

## 后续交付与恢复演练

- docs/delivery/ 保存每批简要说明，命名 YYYY-MM-DD-NN-topic.md，记录完成项、实际验证、遗留项与下一步；docs/progress.md 维护阶段总览。保留历史记录，清理需确认。
- infra/restore-drill.ps1 只读导出带 workout/db 标签的唯一运行中数据库，恢复目标只能是脚本新建、无网络与宿主端口、使用临时内存数据目录的演练容器。不得接受已有恢复目标，不得向源库执行恢复或清理。
- 一致性校验与导出共用 PostgreSQL 导出快照，避免正常会话更新导致误报。演练容器只由本次脚本按唯一标签校验后回收，不删除现有容器或数据卷。
- 归档与校验清单仅放忽略目录 .cache/recovery/<唯一批次>/，不记录账号、原文件或会话内容到普通日志；归档含敏感数据，不提交，后续清理需确认。本机演练不代表异地备份或生产灾备。

## P3 执行范围

- 用户已明确要求继续 P3，授权 DeepSeek 接入及最多 10 次合成数据真实联调，沿用不影响现有数据的授权。凭据只允许运行时注入，不写入文件或日志。
- assistant/ 存快照绑定工具、模型适配、预算、草案校验、任务与确认业务；对应测试使用合成输入/本机模拟模型。docs/contracts/p3-assistant.md 为本机执行契约。
- V4 仅新增 agent_run、plan_draft，不修改既有迁移、原始备份或投影。完整动作库从已鉴权的 READY 原文件提取必要字段，不把历史动作列表冒充完整库；不发送备注、照片或完整备份。
- Agent 独立单并发执行器；调用中断/超时终止，不自动重放付费请求。确认草案和本地应用均幂等，不升级 Dexie schema，不覆盖已有模板。
- server/src/test/ 下 P3LiveProbe 是显式执行的真实模型演练入口，不在默认 verify 自动运行；只接受标准输入凭据，使用自己的 PostgreSQL 与合成夹具，整批请求硬上限 10，证据仅写忽略目录 .cache/。用户已明确允许本次使用所给密钥，后续仍建议轮换。

## P4 验证与交付范围

- 用户要求继续推进，先完善既定 P4 验证，不改数据库 schema、凭据配置或公开发布。本批不新增真实模型调用，既有 10 次联调预算已耗尽。
- server/src/test/ 下 TestApplicationProcess 统一管理仅连接自身 Testcontainers 数据库的测试 JVM；P4RecoveryIT 使用全新的源/目标 PostgreSQL，验证逻辑归档恢复后的应用启动、会话、重新登录、统计、下载和草案确认。
- 恢复测试只使用合成数据；已确认草案和过期任务由明确的测试夹具构造，不将其宣称为真实模型生成。不得读取当前项目数据库、浏览器 profile 或容器中的模型密钥。
- 归档与测试进程日志写入忽略目录 server/target/ 的唯一演练目录，按需保留；测试只回收自己创建的容器与 JVM，不删除用户已有文件、目录或数据卷。
- P4LoadProbe 是显式执行的合成负载入口，不随默认 verify 自动运行；限定 30/365/2000 次训练、最多 80000 组，读取并发 1/2/4/8，每档 64 请求。仅创建自己的数据库/JVM，不连接当前服务，不含真实模型调用；原始结果与查询计划写 server/target/ 唯一目录，不能据此宣称生产容量或性能提升。
- P4RollbackProbe 为显式后端兼容回退探针：仅在自己的 V4 测试库中运行当前 JAR→本机历史 P2 JAR→当前 JAR，不降级数据库；历史 JAR 从本机旧镜像只读提取到忽略目录，不下载或覆盖当前镜像。只创建/按唯一标签回收本次提取容器，不操作运行中的服务。该演练不能代表任意历史版本或完整前端回退。
- server/src/test/resources/contracts/assistant-scenarios.json 保存固定 30 场景合成评测输入及预期；AssistantScenarioEvaluationTest 使用真实引擎/工具/规则与脚本模型执行，报告写 target/assistant-eval-<UUID>/。离线通过率与真实模型建议质量严格分开，不以模拟结果充当真实评测。
- src/api/cloudSession.ts 管理页面内会话失效代号及无敏感内容的跨标签通知；失效后的迟到响应不能回填云页面。tests/contracts/ 的会话检查只使用内存 fetch/事件夹具，不访问浏览器或网络，不能替代浏览器验收。
- 用户本轮明确新增最多 30 次 DeepSeek 请求，AssistantLiveEvaluationProbe 使用独立 .cache/assistant-live-eval2-budget.txt 累计且不重置旧 10 次预算。真实服务上下文执行 6 个生成场景及 8 个请求拒绝场景；其余故障/非法输出场景仅做离线注入，不伪称真实模型必然产生那些错误。凭据仍只用标准输入与进程内存，数据只用隔离合成夹具。
- 新增预算剩余部分可对 A01/A02/A06 增加多动作变体，仍受同一 30 次累计上限控制；不同变体单独保存报告，不覆盖已有结果。infra/rebuild-web.ps1 仅重建并更新 web 服务，通过现有项目数据库容器在内存复用 Compose 所需密码；不读取模型密钥，不更新 server/db，不写 .env。
- tests/contracts/review-assistant-samples.mjs 显式审阅已留存的两份合成真实模型报告，不访问网络或当前数据库；复算计划约束并输出动作覆盖、跨日重复和请求预算指标。派生结果写忽略目录 .cache/，公开文档只保留脱敏汇总，不将这些指标称为训练效果或专家评分。
- infra/check-web.ps1 对本机已构建的 web 镜像创建带唯一标签、无网络/宿主端口/数据卷的临时容器，检查 SPA 深链、静态资源 404 和缓存头；仅回收本次容器，证据写 .cache/。该检查不访问用户浏览器，不能替代 PWA 真实离线/更新验收。
- P3IntegrationIT 的 HTTP 验收覆盖跨账号读取/确认/创建拒绝、同一幂等键在两个账号的并发提交，以及草案并发确认。只使用自身 PostgreSQL、合成账号与 Mockito 模型；并发等待必须有截止时间，不对当前项目服务发送请求，不产生真实模型费用。
- infra/fresh-deployment-drill.ps1 使用现有本机镜像与唯一 Compose 项目名做空库部署验收；覆盖配置必须清空宿主端口与命名卷，数据库只挂 tmpfs，模型凭据显式置空。配置与容器归属检查通过后才能启动/回收，只操作本次项目，不安装工具或修改当前 workout 服务；临时覆盖配置和脱敏报告保留在 .cache/ 唯一目录，凭据仅在进程内，清理这些文件仍需确认。
- 浏览器验收只通过获准的页面操作；.cache/browser-acceptance/ 保存合成上传夹具和带批次前缀的页面截图，禁止复制真实备份、记录凭据或读取浏览器 profile。允许创建一套专用合成云账号/备份，保留测试数据并记录占用，不自动删除或导入本地历史；未获得新预算前不创建付费 Agent 任务。
- BrowserAcceptanceEnvironment 是显式启动的测试环境，不随 verify 自动运行：仅使用独立 Testcontainers PostgreSQL、当前 dist、回环随机端口和唯一会话 Cookie，ModelGateway 固定为 SCRIPTED_NO_REAL_MODEL。临时 HTTP 入口只代理本次 Java 服务，禁止代理当前项目服务；可通过标准输入暂停/恢复自身入口以验收站点不可达时的 PWA。只回收自身进程/容器，不增加生产配置、隐藏测试接口或真实模型请求。元信息与合成页面证据写 .cache/browser-acceptance/ 唯一批次；浏览器数据仅用 UI 新增，不覆盖既有 origin 数据。
- .cache/delivery/ 保存本机源码交付快照、SHA-256 清单和脱敏验收汇总；压缩包只包含明确允许的源码/公开资源/构建配置/文档，不包含 .env、.claude、.cache、数据库归档、浏览器备份、node_modules 或私有模型报告。版本以带唯一批次的快照及摘要标识，不自动 Git 提交、推送或公开发布；归档清理需确认。
