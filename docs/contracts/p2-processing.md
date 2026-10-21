# P2 任务与训练查询契约

按既定实施方案推进；只新增派生数据，不改 IndexedDB 或备份原字节。现有 P1 备份保持 NOT_REQUESTED，用户明确 POST /api/v1/backups/{id}/retry 后才处理。新上传与任务创建同事务提交，返回 202；同键重放 200，metadata 包含 jobId。

## 任务与事务

任务状态 PENDING/RUNNING/RETRY_WAIT/SUCCEEDED/FAILED；投影状态 NOT_REQUESTED/PROCESSING/READY/FAILED。一个备份最多一个任务行。领取使用短事务 FOR UPDATE SKIP LOCKED，每次尝试生成 executionToken，租约默认 30 秒，5 秒续期，单次总期限 120 秒，自动最多 3 次，退避 2×attempt² 秒。全部期限依据数据库 clock_timestamp，不依赖 JVM 与数据库时钟一致。

仅暂时/可恢复数据访问错误和连接资源故障自动重试；校验、SQL 约束/语法及程序错误直接失败，避免对永久问题重复消耗资源。迟到心跳通过任务生命周期锁隔离，不得中断线程上的后续任务。

有界执行器并发 2、缓冲 2，领取许可总数 2（覆盖提交、排队及运行），先有许可再领取，不会预取额外任务。输入解析在事务外进行；结构化结果以分批 SQL 在一次事务内发布。提交成功时必须以 token、RUNNING、租约及总期限条件更新任务为 SUCCEEDED；条件不满足则投影、READY 与成功状态全部回滚。续期不会越过总期限。旧执行者不能提交新租约下的结果。

过期任务恢复为 RETRY_WAIT，次数已满则 FAILED，业务状态同事务变 FAILED。永久内容错误不自动重试，暂时数据库错误有限重试。FAILED 的显式人工重试最多 3 次，重新开始自动尝试预算；READY 不重复投影。下载不依赖投影成功，失败仍可恢复原文件。不得编造百分比，仅展示真实状态和错误码。

V3 只新增 background_job、snapshot_session、snapshot_session_exercise、snapshot_set、snapshot_weight，并扩展原 projection_status CHECK。旧行、原始字节和版本元数据不变；不删除投影/任务来实现重试。失败事务不会留下半份投影，成功后不可变。保留独立复合约束防止投影跨备份关联。

## 统计

session.date 按上传时选定 IANA 时区转换成日历日期；weights.date 原样作为日期。云端只统计 finished===true 的记录。有效组 completed===true 且 warmup!==true，容量为有效组的 weight×reps，缺项贡献 0。使用确定性的 SQL/BigDecimal，不由模型计算。

类别优先 aerobic===true 为 AEROBIC；否则无动作且没有真值 startTime 为 REST；其余 STRENGTH，包括有 startTime 但动作被清空的训练。训练次数按 session，训练天数按日历日期去重并排除 REST；部位天数按部位+日期去重。动作库引用缺失保留容量，部位未知。部位按训练中出现动作归属计日，不要求组完成。

每日体重先从同日时间最近的有效 session.weight 回填，再由独立 weights 覆盖；同一时间以源 ID 排序稳定仲裁，不按数组顺序决定。体重回填包含未完成 session，其独立记录不等同于完成训练统计。照片不进入投影。

已知原 Stats 页面“部位天数”的实现仅在单个 session 内去重，同日多 session 仍会累加；云端按契约在整日去重。本轮不悄悄修改原统计页，差异在云端说明。

## 接口

统一 /api/v1。GET /jobs/{id} 只允许本人；POST /backups/{id}/retry 对未申请/失败备份创建或重试任务，其他状态 409。GET /backups/{id}/statistics、/sessions、/exercises/{sourceId}/progress 必须本人且 READY，否则 404/409。

统计无日期参数时使用整个已验证快照；显式范围需要 from/to 同时出现，起止包含，最多 3660 天。sessions 默认 20、最大 50；动作趋势最大 500 个日期点，超过要求缩小日期范围而非静默截断。元数据展示上传时间、数据覆盖范围与固定时区。所有查询只读投影，不重新解析原文件。

GET /backups/{id}/exercises 提供趋势选择列表，最大 5000 个不同源动作，超限明确报错。sessions 使用有界 offset（0–20000）分页，因快照不可变，不会被后续写入改变页边界。日期仅支持公元 1–9999；极端小数需符合 PostgreSQL NUMERIC 的精度范围，超限投影失败但原始文件保留。正常十进制容量精确计算；不承诺与 JavaScript IEEE 浮点结果逐比特一致。

Micrometer 保存领取、成功、失败、重试及租约恢复计数、队列等待/运行数与最老等待时长、投影处理时长。指标不使用用户/备份/任务 ID 标签。指标是当前进程观测，重启后计数重置，不等于业务历史的持久审计。

故障验证覆盖：竞争领取、过期恢复、旧 token 提交失败、最大重试、插入一半故障回滚、任务/READY 同事务、两用户越权、原下载不受失败影响。共享夹具覆盖凌晨、夏令时、同日多次、未完成、热身、有氧、休息、缺动作和体重覆盖。
