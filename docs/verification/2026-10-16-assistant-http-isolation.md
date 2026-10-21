# Agent HTTP 隔离与并发验收

日期：2026-10-16。测试位于 `server/src/test/java/io/github/cgz4526/workout/assistant/P3IntegrationIT.java`，在独立 PostgreSQL 与随机 HTTP 端口上执行，模型由 Mockito 替代，不连接当前服务、数据库或浏览器，不产生真实模型请求。

## 本批补充

| 验证点 | 实际方式 | 预期 |
|---|---|---|
| 跨账号读取 | 另一已登录账号通过 HTTP 读取任务、草案、完整快照动作库 | 分别 404，并返回对应错误码，不带计划/依据内容 |
| 跨账号确认 | 另一账号携带自己的有效 CSRF，提交正确的他人草案 ID | 404 PLAN_NOT_FOUND |
| 引用他人快照创建任务 | 另一账号提交合法日期、允许动作与自己的 CSRF | 404 BACKUP_NOT_FOUND；该账号无新增任务，不调用模型 |
| 两账号共用同一幂等键 | 两账号各 4 个 HTTP 请求，经开始屏障同时提交，共 8 请求 | 每账号 1 个 202、3 个 200，同账号同任务；两账号任务 ID 不同 |
| 数据归属与幂等冲突 | 核对持久化的用户/快照归属，变化输入再次使用同键 | 每账号仅 1 条任务；他人不可读取；变化输入 409 IDEMPOTENCY_CONFLICT |
| 活跃配额 | 同账号另起新键提交 | 429 AGENT_QUOTA_EXCEEDED，不影响同键重放 |
| 草案并发确认 | 同一已登录会话的 6 个 HTTP 请求同时确认 version=1 | 全部 200，返回相同 JSON，状态 CONFIRMED/version=2 |
| 确认重放与版本冲突 | 再次确认 version=1，并检查 confirmed_at；再发 version=2 | 原 payload/版本/确认时间保持；version=2 返回 409 |

并发线程开始等待最多 10 秒，每个 HTTP 请求最多 20 秒，Future 取值最多 30 秒，线程池退出等待最多 10 秒，失败不能无限挂起。创建并发测试只验证持久提交，不执行模型；确认测试通过模拟模型的 2 次响应生成合成草案，不冒充真实 DeepSeek 结果。

这些测试补充 HTTP、认证会话、CSRF、业务事务与真实 PostgreSQL 的联合证据。它们不是浏览器点击回归，也不是多用户负载或生产容量测试。

## 执行记录

首轮失败来自本批新增的测试辅助 SQL 错把 `normalized_username` 写成 `username`，导致 3 个测试错误；已按现有 schema 修正，没有修改迁移或增加兼容假字段。首轮失败日志保留在 `.cache/p4-http-isolation-verify.log`。

修正后完整 Maven Wrapper verify 通过：102 项（78 单元、24 PostgreSQL/HTTP 集成），0 失败、0 错误、0 跳过。P3IntegrationIT 为其中 8 项，含本批新增 2 项及扩展的原 HTTP 用例；冷恢复、进程中断恢复等既有验证也重新通过。最终日志保存在 `.cache/p4-http-isolation-verify-final.log`，明细在 `server/target/surefire-reports/` 和 `server/target/failsafe-reports/`。

复现：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:MAVEN_USER_HOME = "$PWD\.cache\maven"
Set-Location server
.\mvnw.cmd '-Dmaven.repo.local=../.cache/m2' -B verify
```

本批仅改测试与契约说明，运行中的前后端镜像不需要替换。真实模型预算保持 29/30，剩余 1 次未使用。浏览器站点拒绝设置仍未解除，实际点击、移动端、离线和 PWA 更新验收保持待办。
