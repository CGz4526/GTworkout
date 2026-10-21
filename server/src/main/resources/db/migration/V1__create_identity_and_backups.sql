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

