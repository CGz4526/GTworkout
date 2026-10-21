# P1 首次迁移审批稿

状态：2026-10-16 用户授权在不影响现有数据的前提下直接执行。实施仅针对本项目专用新建库、命名卷与隔离测试库，不修改其他数据库或浏览器数据。

## 目标和影响

在项目专用 PostgreSQL 17 数据库 workout 中创建业务表、会话表和 Flyway 历史表。不连接或修改本机已有 MySQL、PostgreSQL 或其他项目数据库。开发库通过本项目 Compose 专用命名卷 workout_postgres_data 持久化，数据库不发布宿主端口。测试仅在 Testcontainers 临时 PostgreSQL 17 中运行同一套迁移；不得连接开发库测试。

首次执行前检查目标数据库不包含用户业务表；非空目标拒绝自动 baseline。禁止 clean、repair、删除表、自动回滚和自动清空卷。后续修改采用新增版本，不修改已应用迁移。故障停止启动并保留数据，由错误报告确定后续处理。

PostgreSQL 17 具体补丁和镜像摘要待可达的官方镜像验证后固定，不复用已有 pg16 镜像。数据库凭据由用户以环境变量注入，不写文件，不使用固定默认密码，不从本机其他项目读取。

## 版本与依赖

本机已解析的 Boot 4.0.8 BOM 管理 Spring Session 4.0.5、Flyway 11.14.1、PostgreSQL JDBC 42.7.13、Testcontainers 2.0.5。MyBatis Starter 使用 4.0.x 兼容线，在实现前解析并固定可用补丁；不引入 JPA。Flyway 同时引入 PostgreSQL database 支持模块。

## V1__create_identity_and_backups.sql 草案

```sql
CREATE TABLE app_user (
    id uuid PRIMARY KEY,
    normalized_username varchar(32) NOT NULL,
    password_hash varchar(100) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_app_user_username UNIQUE (normalized_username),
    CONSTRAINT ck_app_user_username CHECK (
        normalized_username ~ '^[a-z0-9_]{3,32}$'
    ),
    CONSTRAINT ck_app_user_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE backup_snapshot (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user(id),
    idempotency_key uuid NOT NULL,
    request_fingerprint char(64) NOT NULL,
    sha256 char(64) NOT NULL,
    size_bytes integer NOT NULL,
    format_version smallint NOT NULL,
    contract_version smallint NOT NULL,
    timezone varchar(64) NOT NULL,
    raw_bytes bytea NOT NULL,
    exercise_count integer NOT NULL,
    template_count integer NOT NULL,
    session_count integer NOT NULL,
    weight_count integer NOT NULL,
    projection_status varchar(16) NOT NULL DEFAULT 'NOT_REQUESTED',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_backup_user_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT ck_backup_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_backup_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_backup_size CHECK (size_bytes BETWEEN 1 AND 20971520),
    CONSTRAINT ck_backup_raw_size CHECK (octet_length(raw_bytes) = size_bytes),
    CONSTRAINT ck_backup_format CHECK (format_version IN (1, 2, 3)),
    CONSTRAINT ck_backup_contract CHECK (contract_version = 1),
    CONSTRAINT ck_backup_timezone CHECK (char_length(timezone) BETWEEN 1 AND 64),
    CONSTRAINT ck_backup_counts CHECK (
        exercise_count BETWEEN 0 AND 5000
        AND template_count BETWEEN 0 AND 1000
        AND session_count BETWEEN 0 AND 20000
        AND weight_count BETWEEN 0 AND 20000
    ),
    CONSTRAINT ck_backup_projection CHECK (projection_status = 'NOT_REQUESTED')
);

CREATE INDEX ix_backup_user_created_id
    ON backup_snapshot(user_id, created_at DESC, id DESC);
```

UUID 由应用生成，不安装 UUID 扩展。业务外键默认 RESTRICT/NO ACTION，不提供用户或备份删除接口。sha256 由应用对原始字节计算，数据库验证格式及字节数，不安装 pgcrypto。列表查询显式选元数据列，不 SELECT *，避免读取 BYTEA。

P1 原始文件经同步验证和事务提交后即可下载，因此状态是 NOT_REQUESTED，不伪造 PROCESSING 或 jobId。P2 用独立迁移扩展状态约束并引入任务表，不在 P1 建空队列。首次成功上传返回 201 Created，而 P2 有任务的上传才返回 202 Accepted。

## V2__create_spring_session.sql 草案

使用 [Spring Session JDBC 4.0.5 官方 PostgreSQL schema](https://github.com/spring-projects/spring-session/blob/4.0.5/spring-session-jdbc/src/main/resources/org/springframework/session/jdbc/schema-postgresql.sql)，创建 SPRING_SESSION、SPRING_SESSION_ATTRIBUTES 两张表，包含 SESSION_ID 唯一索引、EXPIRY_TIME 与 PRINCIPAL_NAME 索引。

获批后从锁定依赖 JAR 提取完整官方脚本并核对来源，不在此复制为另一份手工维护的 schema。唯一允许的 ON DELETE CASCADE 是官方会话属性到会话的外键，用于退出/过期后清理会话。它不会删除业务用户或备份。配置 spring.session.jdbc.initialize-schema=never，结构仅由 Flyway 管理；会话过期清理由 Spring Session 负责。

## 并发与容量

上传在开始解析前使用进程内有界许可：每用户最多 1 个进行中的请求、全进程最多 2 个。超限立即 429；该限制只适用于首版单实例，重启即清空。校验前拒绝已知超大 Content-Length，实际流读取硬限 20 MiB。

校验完成后进入短事务，对当前 app_user 行 SELECT ... FOR UPDATE，依次检查同 key 重放、版本数和累计字节，再插入。用户最多 20 份、总原始文件最多 200 MiB；不同 key 的竞争上传也在同一用户锁下仲裁。数据库 UNIQUE(user_id,idempotency_key) 是最终防线，不能只凭先查询。固定流程中所有上传均先锁同一用户行，再访问备份，避免反向加锁。

同 key、同指纹先返回原资源，不因额度已满拒绝重放；同 key、不同指纹返回 409。插入失败事务回滚，不预增计数器；额度由持锁事务内 COUNT/SUM 查询计算。P1 没有删除或清理作业。

20 MiB 单份和 200 MiB/用户是上界，不是数据库磁盘预算。10 个满额用户原始文件已达 2 GiB，另有 WAL、TOAST、会话、索引和备份开销；公开注册默认关闭，单机可配置账户总量。实际压测后再调整额度，不承诺吞吐。

## 授权范围

需批准：将上述业务 DDL 和版本匹配的官方会话脚本加入 Flyway，在本项目专用新建库和隔离测试容器首次执行，共四张业务/会话表及 Flyway 历史表；包含命名持久卷与会话到期清理。批准不涵盖任何已有数据库变更、删除数据/卷、系统配置、真实 .env、CI/CD 或公开部署。
