# P1/P2 数据库设计审阅稿

状态：P1 已按用户“不影响现有数据即可执行”的授权落地，正式结构见 server/src/main/resources/db/migration/。P2 仍为设计，实施保持专用库隔离。

P1 具体审批入口：[首次迁移审批稿](p1-migration-review.md)，含 app_user、backup_snapshot 的完整 DDL、会话表来源、专用执行目标和额度并发规则。该稿优先于下表的早期简写；P1 的正式备份表名为 backup_snapshot。

PostgreSQL 17；所有时间戳用 timestamptz，日历日期用 date；主键 UUID，原始来源 ID 用受限长度 text。用户名规范化策略必须在 P1 明确，密码只存 BCrypt 哈希，UTF-8 输入上限 72 字节。

| 表 | 关键字段与约束 | 阶段 |
|---|---|---|
| app_user | id，normalized_username 唯一，password_hash，created_at | P1 |
| Spring Session 官方表 | 使用与选定 Spring Session 版本一致的 PostgreSQL schema，不手写缩减版 | P1 |
| backup | id，user_id 外键，idempotency_key，sha256，fingerprint，timezone，contract_version，format_version，raw_bytes BYTEA，size_bytes，created_at；unique(user_id,idempotency_key) | P1 |
| job | id，user_id，backup_id，type，status，attempt，execution_token，lease_until，next_run_at，error_code，created_at；任务领取索引(status,next_run_at) | P2 |
| training_session | backup_id，source_id，source_iso，local_date，finished，kind；unique(backup_id,source_id)，索引(backup_id,local_date) | P2 |
| training_set | backup_id，session_id，source_exercise_id，ordinal，completed，warmup，weight，reps；业务键唯一，索引(backup_id,source_exercise_id) | P2 |
| daily_weight | backup_id，local_date，weight；unique(backup_id,local_date) | P2 |

每个按资源 ID 的查询都验证服务端当前 user_id；拒绝客户端指定所有者。P2 投影与 READY 状态同事务发布。任务条件提交必须匹配 execution_token 和有效租约，旧执行者不能覆盖结果。

初始候选限额：文件 20 MiB、入口 21 MiB、每用户同时上传 1、最多保留 20 份备份；限额尚需合成数据与目标机器实测。JSON 深度、节点、数组和字符串预算在正式上传契约中明确。超限返回稳定错误码，不截断照片。schema 中添加 size_bytes 与状态的 CHECK；数值范围在共享契约确定后固化。

实施前还需审阅：完整列类型、外键与级联策略（默认不级联删除）、状态机 CHECK、任务唯一性、账号并发配额仲裁、Spring Session 索引，以及 Flyway 执行目标。当前没有进行任何 schema 修改。
