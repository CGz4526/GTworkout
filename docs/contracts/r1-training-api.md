# R1 训练写模型与 API 契约

状态：待审阅，2026-10-16；没有已实现的新接口。对应 [总方案](../server-managed-training-plan.md)。仅冻结 R2/R3 所需设计，R4 路由不冒充本轮交付。

2026-10-17实现补充：下列训练/动作首版接口已在功能开关下实现并隔离验收；正式运行服务尚未升级。响应为session/version/editorDeviceId/updatedAt，幂等凭证保存在服务端；当前限制及实现差异见 [交接](../training-v1-handoff.md)。历史状态文字是本稿编写时的记录。

## 1. 首版业务范围

账号模式下创建、继续、完成训练及跨设备查看。支持 STRENGTH、AEROBIC、REST 三类；保留模板名称、动作名称、休息配置、备注和饮食字段。照片、每日体重和模板库暂不纳入训练同步，页面单独标明仍在本地，不能用“全部已同步”描述。

未启用账号模式时沿用原访客体验。历史已完成记录的修改/删除首版在账号空间只读，不能继续写旧库后伪装已同步；访客空间保留原编辑。未上传的训练可本地取消，已创建云端 ACTIVE 训练用 CANCELLED 状态取消，不在手机删除后留下云端幽灵训练。完整软删除在 R4。

## 2. 标识与数据结构

全部新 ID 使用 UUID，用户身份只取服务端会话。exerciseRecordId 与 setId 独立稳定，不用数组下标充当身份。动作引用按用户隔离；首次使用通过动作接口幂等创建，训练请求不能顺便覆盖已有动作名称。

```json
{
  "mutationId": "cdcd5bbd-e951-4385-991d-3d48adbce201",
  "expectedVersion": 0,
  "deviceId": "bf125b17-8a8d-4cd5-860f-e470d451227d",
  "session": {
    "id": "69df59f4-54de-4dd9-abfb-24b2fda4f683",
    "type": "STRENGTH",
    "status": "ACTIVE",
    "occurredAt": "2026-10-16T02:00:00Z",
    "localDate": "2026-10-16",
    "utcOffsetMinutes": 480,
    "startedAt": "2026-10-16T02:00:00Z",
    "durationSeconds": 0,
    "templateName": "腿训日",
    "exercises": [{
      "id": "02e14148-d4c5-4bdc-a0e5-b990854ff986",
      "exerciseId": "ff4ab303-5b58-46b0-9062-8e7d0a25b081",
      "exerciseName": "深蹲",
      "restSeconds": 150,
      "sets": [{
        "id": "dfd17659-b7cd-4f87-bfb8-0b43fbbeab41",
        "weightKg": 40,
        "reps": 10,
        "completed": true,
        "warmup": false,
        "rpe": 7.5
      }]
    }]
  }
}
```

PUT 使用同一结构，body session.id 必须等于 path。响应为 `{session, version, updatedAt, mutationId}`，不暴露内部 user_id；version 从 1 开始。body 字段白名单，拒绝未知字段与 NaN/Infinity；null 表示清空可选值，不将缺失误作保留旧值。PUT 为全量替换可编辑业务字段，不是局部 patch。

### 字段边界（建议初始上限，实施测试后才能宣称已支持）

| 字段 | 规则 |
|---|---|
| 类型/状态 | STRENGTH/AEROBIC/REST；ACTIVE/COMPLETED/CANCELLED |
| 时间 | RFC3339 时刻；offset 为 -840..840；localDate 必须与 occurredAt 加该偏移一致，旧数据在迁移预览确认日期 |
| 日期修改 | ACTIVE 可修改；COMPLETED 首版不修改；不因查看设备时区不同重算历史业务日期 |
| 时长 | 整数秒 0..604800；ACTIVE 时为观测值，完成时持久化；不证明真实运动时间 |
| 重量/次数 | weightKg 可空，0..1000、最多 3 位小数；reps 可空，整数 0..10000 |
| 完成/热身 | 必填 boolean；有效组仍为 completed 且非 warmup，允许自重组不填重量 |
| RPE | 可空，6..10、0.5 步进；新写入非法值拒绝，不能静默归一化 |
| 动作/组数量 | 每训练最多 100 个动作记录，每动作最多 100 组；总共最多 2000 组 |
| 名称 | 去两端空格后 1..100 字符；历史名称快照不跟随动作库变化 |
| 休息 | 整数秒 30..600；缺省由前端解析模板>动作>默认后提交实际值 |
| 备注/饮食 | 备注最多 2000 字符；diet 可空或 low/mid/high/cheat |
| 有氧 | distanceKm 可空，0..10000、最多 3 位小数；无力量动作组 |
| 休息日 | COMPLETED、时长 0，无动作/距离/计时字段；新建可显式选择，不开启账号模式自动补昨日休息日 |
| 请求体 | JSON 解码前最大 1 MiB；照片/base64 不接受；不能占用原 20 MiB 备份上传额度规则 |

空训练可以 ACTIVE；完成力量训练不要求每组都完成，保持现有有效组语义。原不足一分钟丢弃属于前端产品规则，服务端用 CANCELLED 表达已上云的取消；补录训练不应被该计时规则错误拒绝。

## 3. 接口与状态转换

| 方法和路由（/api/v1） | 行为 |
|---|---|
| POST /exercises | mutationId + UUID 幂等创建最小动作；首版仅创建/查询，不改删动作库 |
| GET /exercises?cursor=...&limit=... | 当前账号动作列表，供依赖解析 |
| POST /workout-sessions | expectedVersion=0；可 ACTIVE 或直接 COMPLETED 补录/导入；非导入不允许 CANCELLED 创建 |
| PUT /workout-sessions/{id} | expectedVersion>=1；ACTIVE→ACTIVE/COMPLETED/CANCELLED；终态不再次改变 |
| GET /workout-sessions/{id} | 返回详情、version、editorDeviceId；跨账号/不存在同为404 |
| GET /workout-sessions?cursor=...&limit=... | limit 默认20最大100；按 occurredAt DESC,id DESC；取消项默认不展示，可显式查自己的取消项 |

单用户最多一条 ACTIVE，新增有氧亦受此约束；补录 COMPLETED 不占用该名额。已有活动训练返回409 ACTIVE_SESSION_EXISTS并提供自己的资源ID。列表用签名或服务端验证的游标；首次请求固定 created_at 截止时间，后续新建记录在刷新后出现。首版不提供跨页强快照保证，重复ID由客户端去重。

ACTIVE 编辑设备不一致返回409 EDITOR_DEVICE_MISMATCH，首版无接管接口，其他设备提示回原设备完成；设备丢失时的接管在R4实现，不能暗示首版可自助解决。此限制必须在启用页说明。

## 4. 服务端事务顺序

1. 认证、CSRF、字节限制与结构校验；用户行加锁，所有同用户写事务遵循同一顺序。
2. 查询 `(user_id,mutation_id)`；命中同摘要返回已保存响应，异摘要409 IDEMPOTENCY_KEY_REUSED。
3. 核对聚合所属、版本、设备、状态及动作归属；校验子ID无重复、无跨训练复用。
4. 更新聚合及关系记录、版本+1，保存幂等响应，同事务提交。失败全部回滚。
5. 返回已确认版本。普通日志只记录请求ID、状态码和错误码，不记录备注、训练内容或响应体。

R2先保留幂等结果不自动清理，避免过期重试重复提交；对账号幂等记录配置上限（初值100000），到达后明确拒绝新写并提示维护，不能偷偷删后继续。后续清理策略另审阅。训练同用户串行用于小规模首版，无高并发承诺。

响应丢失：相同mutation重试得到同响应。事务前崩溃无结果可重试；提交后崩溃查幂等结果。冲突响应包含当前版本和可查询的当前用户资源ID，不返回其他用户数据。格式400、认证401、CSRF403、资源404、业务冲突409、体积413、字段422、频控429、未知500；不能默认返回成功。

### R2 输入规则实现说明

首批实现为纯 `WorkoutInput` 边界规则，尚无HTTP端点或数据库写入。摘要使用原始UTF-8请求字节SHA-256，客户端重试必须重用冻结的原始请求体；同mutation重新序列化导致字节变化按不同内容处理，后续若改规范化算法需版本化。接口方法/目标资源还需在服务层与幂等记录一同核验，不能只比正文摘要。

解析拒绝重复JSON字段、多个根文档、非法UTF-8、未知字段及超出预算的输入。名称/备注等文本由客户端去两端空白，可选空文本提交null；规则不静默截断。startedAt/finishedAt可选，但结束不得早于开始、ACTIVE不得带finishedAt。账户归属、动作存在、当前训练类型不变及跨训练子ID引用属于后续事务服务校验，纯输入校验不宣称完成这些保证。

## 5. 验收编号

R2-01跨账号训练/动作读写404；02跨父组ID拒绝；03同键并发单条；04同键异体409；05两个版本并发仅一次成功；06写到半程故障回滚；07提交后丢响应再试结果一致；08活动训练唯一；09设备不一致拒绝；10完成/取消后修改拒绝；11字段边界、体积和数量；12分页同时间记录稳定；13日期东八区凌晨及负偏移；14有效组与容量共享夹具；15动作创建重试与同用户引用；16取消释放ACTIVE名额。均需真实PG/HTTP测试，本文未执行。
