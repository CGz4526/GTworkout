CREATE TABLE agent_run (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    backup_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    fingerprint char(64) NOT NULL,
    request_json text NOT NULL CHECK(octet_length(request_json)<=16384),
    model varchar(100) NOT NULL,
    prompt_version varchar(32) NOT NULL DEFAULT 'coach-v1',
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
    execution_token uuid,
    deadline_at timestamptz,
    error_code varchar(64),
    result_json text CHECK(octet_length(result_json)<=32768),
    model_calls integer NOT NULL DEFAULT 0 CHECK(model_calls BETWEEN 0 AND 4),
    tool_calls integer NOT NULL DEFAULT 0 CHECK(tool_calls BETWEEN 0 AND 8),
    total_tokens bigint NOT NULL DEFAULT 0 CHECK(total_tokens>=0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id,idempotency_key),
    UNIQUE(user_id,id),
    FOREIGN KEY(user_id,backup_id) REFERENCES backup_snapshot(user_id,id),
    CHECK((status='RUNNING' AND execution_token IS NOT NULL AND deadline_at IS NOT NULL)
       OR (status<>'RUNNING' AND execution_token IS NULL AND deadline_at IS NULL))
);
CREATE INDEX ix_agent_pending ON agent_run(created_at) WHERE status='PENDING';
CREATE INDEX ix_agent_owner_created ON agent_run(user_id,created_at);
CREATE UNIQUE INDEX uq_agent_active_user ON agent_run(user_id) WHERE status IN ('PENDING','RUNNING');

CREATE TABLE plan_draft (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    run_id uuid NOT NULL UNIQUE,
    status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED')),
    version integer NOT NULL DEFAULT 1,
    payload_json text NOT NULL CHECK(octet_length(payload_json)<=32768),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at timestamptz,
    FOREIGN KEY(user_id,run_id) REFERENCES agent_run(user_id,id),
    CHECK((status='DRAFT' AND version=1 AND confirmed_at IS NULL)
       OR (status='CONFIRMED' AND version=2 AND confirmed_at IS NOT NULL))
);
