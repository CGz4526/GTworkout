# P3 教练 Agent 本机执行契约

状态：本批实施契约，完成状态以验证/交付记录为准。

## 输入与边界

POST /api/v1/assistant/runs，Idempotency-Key UUID，请求包含 backupId、from/to（最近期间，最多 90 天）、days（1–7）、minutes（15–120）、allowedExerciseIds（1–30 个，不重复）、consent=true。当前登录用户与 READY 快照必需；前一等长期间自动计算，不使用服务器今天隐式替代快照日期。缺项返回 422，不猜测约束。全程仅训练计划，不提供医疗诊断。

GET /api/v1/backups/{id}/available-exercises 返回原始快照中的完整动作定义的 ID/名称/部位，最多 5000，不含备注或照片；不是历史出现过的动作列表。模型仅能引用用户选择的允许动作。

模型工具 queryTrainingHistory、compareTrainingPeriods、getExerciseProgress、listAvailableExercises 全部由服务器闭包绑定账号、快照和固定日期；无 userId/backupId 参数。模型参数严格白名单，非法参数终止。工具结果有界；数字依据以服务器生成的统计卡为准，模型自由文本仅作为建议，不作为统计事实。

## 模型与预算

仅 DeepSeek 官方 HTTPS chat/completions；不跟随重定向，不允许用户请求改变 endpoint。WORKOUT_DEEPSEEK_API_KEY、WORKOUT_DEEPSEEK_MODEL 由环境注入，两者齐备才开放生成。未配置时备份/分析继续可用，创建 Agent 返回 503。

单任务最多 4 次模型请求、8 次工具调用、每请求最多 2048 输出 token、总执行 120 秒、单模型请求最多 35 秒；HTTP 响应最多 128 KiB，单轮提示最多 48 KiB。不自动重试 HTTP/模型故障；最终计划校验不通过最多修复一次，仍无效则 FAILED，不返回假成功。

单实例全局并发 1，无模型无限队列预取；每用户最多 1 个活跃任务、20 次/UTC 日、100 条保留任务，无自动删除。首批联调额外遵守用户授权的最多 10 次请求（已用完）；后续用户另批 30 次隔离合成评测预算，当前累计 29 次，独立计数且不重置旧预算，见最新验证记录；用户已明确允许使用本次提供的密钥，运行时注入，不落入文件。

用户选定 deepseek-v4-flash。2026-10-16 核对[官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)：该旧标识仍可调用，实际上路由至 V4.1 Flash，官方推荐新标识 deepseek-flash。保留请求标识，不能把别名当成冻结的模型权重版本。

## 持久化与故障

V4 新建 agent_run（用户/快照、请求、请求指纹、用户幂等 key、PENDING/RUNNING/SUCCEEDED/FAILED、执行代号、deadline、错误码、用量、模型与版本）和 plan_draft（DRAFT/CONFIRMED、版本、计划与本地模板 payload）。不更改已有任务表。

短事务锁用户行完成幂等与配额；原子领取任务。模型调用在事务外、独立执行器中进行。RUNNING 截止时间后标记失败，不自动重复付费；完成时 token+deadline 条件更新，并与草案同事务提交。任务重启前已经请求过模型也不自动重放。PENDING 在重启后可领取。

GET /assistant/runs/{id} 返回任务与成功后的 draftId、服务器依据统计、用量，不返回提示词、密钥、工具原文或内部执行代号。越权 404。

创建幂等键以已认证账号为作用域。相同账号/键/输入重复提交返回同一任务（首次 202，重放 200），输入变化返回 409 IDEMPOTENCY_CONFLICT；不同账号可以独立复用相同键，不共享任务。活跃任务配额不阻止同键重放；新键仍受配额限制。引用他人快照不能创建任务；客户端不能以参数替换已认证账号。

## 草案校验与确认

固定 JSON：{schemaVersion:1, days:[{name, items:[{exerciseId,sets,reps,restSeconds}]}]}。不得额外字段；天数严格匹配输入；每次 1–8 动作；同天动作不重复；动作限允许集合；组数 1–6、次数 1–30、间歇 30–300 秒。名称限制 40 字符。模型不能指定本地动作名称，名称由快照映射。

时长估算：每次 300 秒热身 + 每组 45 秒动作 + (组数−1)×间歇 + 动作数×60 秒切换；向上取整分钟，每天不超过 minutes。这是固定假设，不保证实际训练用时。不生成重量或训练完成记录。

GET /plan-drafts/{id} 取回草案。POST /plan-drafts/{id}/confirm，{version:1}，条件更新 DRAFT→CONFIRMED/version=2；相同原始版本重复确认取得相同 payload，其他版本 409。用户归属必检。

并发确认锁定当前账号的草案行，仅首次确认更新 confirmed_at 和版本。后续 version=1 重放保留原 payload、version=2 与首次确认时间；其他账号读取/确认返回 404 PLAN_NOT_FOUND，不因提供正确草案 ID 而获得权限。

本地每一天对应稳定模板 ID ai-plan-<draftId>-<index>，事务内只添加不存在的模板，不覆盖已应用后用户修改的模板。确认与本地应用分开，断网后可重新获取已确认 payload。无 Dexie schema 变更。
