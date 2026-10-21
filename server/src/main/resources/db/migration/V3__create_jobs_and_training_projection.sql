ALTER TABLE backup_snapshot DROP CONSTRAINT ck_backup_projection;
ALTER TABLE backup_snapshot ADD CONSTRAINT ck_backup_projection CHECK
    (projection_status IN ('NOT_REQUESTED','PROCESSING','READY','FAILED'));
ALTER TABLE backup_snapshot ADD CONSTRAINT uq_backup_owner_id UNIQUE(user_id,id);

CREATE TABLE background_job (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    backup_id uuid NOT NULL UNIQUE,
    type varchar(32) NOT NULL CHECK(type = 'BUILD_PROJECTION'),
    status varchar(16) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED')),
    attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    manual_retries integer NOT NULL DEFAULT 0 CHECK(manual_retries BETWEEN 0 AND 3),
    next_run_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execution_token uuid,
    lease_until timestamptz,
    deadline_at timestamptz,
    error_code varchar(64),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id,backup_id) REFERENCES backup_snapshot(user_id,id),
    CHECK((status='RUNNING' AND execution_token IS NOT NULL AND lease_until IS NOT NULL AND deadline_at IS NOT NULL)
        OR (status<>'RUNNING' AND execution_token IS NULL AND lease_until IS NULL AND deadline_at IS NULL))
);
CREATE INDEX ix_job_due ON background_job(status,next_run_at,created_at);
CREATE INDEX ix_job_lease ON background_job(lease_until) WHERE status='RUNNING';

CREATE TABLE snapshot_session (
    id uuid PRIMARY KEY,
    backup_id uuid NOT NULL REFERENCES backup_snapshot(id),
    source_id varchar(128) NOT NULL,
    source_iso text NOT NULL,
    started_at timestamptz NOT NULL,
    local_date date NOT NULL,
    kind varchar(16) NOT NULL CHECK(kind IN ('STRENGTH','AEROBIC','REST')),
    finished boolean NOT NULL,
    name text,
    duration integer NOT NULL CHECK(duration BETWEEN 0 AND 604800),
    distance numeric NOT NULL CHECK(distance BETWEEN 0 AND 10000),
    UNIQUE(backup_id,source_id),
    UNIQUE(backup_id,id)
);
CREATE INDEX ix_session_date ON snapshot_session(backup_id,local_date,id);

CREATE TABLE snapshot_session_exercise (
    id uuid PRIMARY KEY,
    backup_id uuid NOT NULL,
    session_id uuid NOT NULL,
    ordinal integer NOT NULL CHECK(ordinal>=0),
    source_exercise_id text NOT NULL,
    exercise_name text,
    body_part text NOT NULL,
    UNIQUE(session_id,ordinal),
    UNIQUE(backup_id,id),
    FOREIGN KEY(backup_id,session_id) REFERENCES snapshot_session(backup_id,id)
);
CREATE INDEX ix_exercise_source ON snapshot_session_exercise(backup_id,source_exercise_id);

CREATE TABLE snapshot_set (
    backup_id uuid NOT NULL,
    exercise_id uuid NOT NULL,
    ordinal integer NOT NULL CHECK(ordinal>=0),
    weight numeric CHECK(weight BETWEEN 0 AND 2000),
    reps integer CHECK(reps BETWEEN 0 AND 1000),
    completed boolean NOT NULL,
    warmup boolean NOT NULL,
    rpe numeric CHECK(rpe BETWEEN 6 AND 10 AND mod(rpe*2,1)=0),
    PRIMARY KEY(exercise_id,ordinal),
    FOREIGN KEY(backup_id,exercise_id) REFERENCES snapshot_session_exercise(backup_id,id)
);
CREATE INDEX ix_set_backup ON snapshot_set(backup_id);

CREATE TABLE snapshot_weight (
    backup_id uuid NOT NULL REFERENCES backup_snapshot(id),
    local_date date NOT NULL,
    weight numeric NOT NULL CHECK(weight>0 AND weight<=1000),
    source varchar(16) NOT NULL CHECK(source IN ('EXPLICIT','SESSION')),
    PRIMARY KEY(backup_id,local_date)
);
