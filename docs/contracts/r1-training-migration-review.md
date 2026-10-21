# R1 数据库新增迁移审阅稿

状态：待审阅，不可视为执行授权。2026-10-16。依据 [API契约](r1-training-api.md)。本文件不在Flyway扫描目录，没有执行以下SQL；迁移编号需实施时确定。目标仅本项目专用库及隔离测试库，不操作其他库。

2026-10-17：实际隔离执行稿为 [r2-training-schema.sql](r2-training-schema.sql)，获用户单独授权后已在自建测试库执行。仍未进入Flyway目录，也未执行当前开发库迁移。实际新增document缓存列及写事务取舍见 [ADR](../adr/0005-server-managed-training-v1.md)。

## 1. R2 最小新增表设计

下面展示关键约束，不是可直接发布的完整迁移：还需按字段契约补齐边界、命名、索引验证和真实PG测试。既有 app_user.id 为 UUID；不修改历史迁移或 snapshot_* 表。

```sql
CREATE TABLE live_exercise (
  user_id uuid NOT NULL REFERENCES app_user(id),
  id uuid NOT NULL,
  name varchar(100) NOT NULL,
  body_part varchar(32) NOT NULL,
  rest_seconds integer NOT NULL CHECK (rest_seconds BETWEEN 30 AND 600),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE live_session (
  user_id uuid NOT NULL REFERENCES app_user(id),
  id uuid NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('STRENGTH','AEROBIC','REST')),
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  occurred_at timestamptz NOT NULL,
  local_date date NOT NULL,
  utc_offset_minutes smallint NOT NULL CHECK (utc_offset_minutes BETWEEN -840 AND 840),
  started_at timestamptz,
  finished_at timestamptz,
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 0 AND 604800),
  template_name varchar(100),
  notes varchar(2000),
  diet varchar(8) CHECK (diet IN ('low','mid','high','cheat')),
  distance_km numeric(8,3) CHECK (distance_km BETWEEN 0 AND 10000),
  editor_device_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,id)
);
CREATE UNIQUE INDEX live_session_one_active ON live_session(user_id) WHERE status='ACTIVE';
CREATE INDEX live_session_history ON live_session(user_id,occurred_at DESC,id DESC);

CREATE TABLE live_session_exercise (
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  exercise_name varchar(100) NOT NULL,
  rest_seconds integer NOT NULL CHECK (rest_seconds BETWEEN 30 AND 600),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (user_id,session_id,id),
  UNIQUE (user_id,id),
  UNIQUE (user_id,session_id,position),
  FOREIGN KEY (user_id,session_id) REFERENCES live_session(user_id,id),
  FOREIGN KEY (user_id,exercise_id) REFERENCES live_exercise(user_id,id)
);

CREATE TABLE live_set (
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  session_exercise_id uuid NOT NULL,
  id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  weight_kg numeric(7,3) CHECK (weight_kg BETWEEN 0 AND 1000),
  reps integer CHECK (reps BETWEEN 0 AND 10000),
  completed boolean NOT NULL,
  warmup boolean NOT NULL,
  rpe numeric(3,1) CHECK (rpe BETWEEN 6 AND 10 AND mod(rpe,0.5)=0),
  PRIMARY KEY (user_id,session_id,id),
  UNIQUE (user_id,id),
  UNIQUE (user_id,session_id,session_exercise_id,position),
  FOREIGN KEY (user_id,session_id,session_exercise_id)
    REFERENCES live_session_exercise(user_id,session_id,id)
);

CREATE TABLE training_mutation (
  user_id uuid NOT NULL REFERENCES app_user(id),
  mutation_id uuid NOT NULL,
  request_sha256 char(64) NOT NULL,
  resource_type varchar(32) NOT NULL,
  resource_id uuid NOT NULL,
  response_status smallint NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,mutation_id)
);
```

## 2. 事务及数据影响

- 新增上述五表和索引，无旧表覆盖、重命名、删除、全表重写或自动历史回填；旧备份/账号/会话/草案保留。
- 聚合更新使用差异更新/顺序调整策略，避免重排导致唯一 position 临时冲突；最终策略在实施测试固定，不能绕过约束。
- 逻辑移除某组是用户授权的业务编辑，物理删除子行的实现需随具体SQL审阅；本稿不执行任何 DELETE。CANCELLED保留聚合，不删除云训练。
- 锁顺序统一 app_user→mutation→session→子行。用户锁不在模型调用或网络等待中持有；训练事务只做数据库操作。
- 数量上限、跨字段类型规则和状态转换由Service实现；数据库约束兜底数值与归属。不以CHECK替代所有业务验证。
- 幂等响应包含训练内容，属于敏感持久数据；不进入日志，不含照片或凭据；备份/恢复需一并保护。
- 聚合替换前验证子ID归属；移除后重新使用已删除ID的边界由幂等及版本保护，首版不提供独立子记录URL。

## 3. 后续表与待定项

R3导入需新增 training_import/source_mapping，R4再引入模板/体重/照片/变更流水；本稿不以空表预占功能。旧ID映射持久化的字段与唯一约束在导入实现前补审阅，不用临时内存承担可重入保证。

R2测试库迁移前：补齐完整SQL并检验表名、精度、约束错误映射、历史Flyway校验。当前开发库执行前：说明实际迁移版本与目标、保存恢复证据、明确用户授权。不得将现有旧阶段新增授权自动解释为本阶段任意迁移授权。

回退只停用新写入口并保留表；不运行down迁移或删表。旧版看不到新训练，需提供导出/查看路径后才允许产品回退。
