-- V5 approved for isolated verification; server execution requires separate approval.
CREATE TABLE live_exercise (
 user_id uuid NOT NULL REFERENCES app_user(id), id uuid NOT NULL,
 name varchar(100) NOT NULL CHECK(length(btrim(name))>0),
 body_part varchar(32) NOT NULL CHECK(length(btrim(body_part))>0),
 rest_seconds integer NOT NULL CHECK(rest_seconds BETWEEN 30 AND 600),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id)
);
CREATE TABLE live_session (
 user_id uuid NOT NULL REFERENCES app_user(id), id uuid NOT NULL,
 type varchar(16) NOT NULL CHECK(type IN ('STRENGTH','AEROBIC','REST')),
 status varchar(16) NOT NULL CHECK(status IN ('ACTIVE','COMPLETED','CANCELLED')),
 occurred_at timestamptz NOT NULL, local_date date NOT NULL,
 utc_offset_minutes smallint NOT NULL CHECK(utc_offset_minutes BETWEEN -840 AND 840),
 started_at timestamptz, finished_at timestamptz,
 duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 0 AND 604800),
 template_name varchar(100), notes varchar(2000),
 diet varchar(8) CHECK(diet IN ('low','mid','high','cheat')),
 distance_km numeric(8,3) CHECK(distance_km BETWEEN 0 AND 10000),
 editor_device_id uuid NOT NULL, version bigint NOT NULL CHECK(version>0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), CHECK(finished_at IS NULL OR started_at IS NULL OR finished_at>=started_at),
 CHECK(status<>'ACTIVE' OR finished_at IS NULL),
 CHECK(type='AEROBIC' OR distance_km IS NULL),
 CHECK(type<>'REST' OR (status='COMPLETED' AND duration_seconds=0 AND started_at IS NULL AND finished_at IS NULL))
);
CREATE UNIQUE INDEX live_session_one_active ON live_session(user_id) WHERE status='ACTIVE';
CREATE INDEX live_session_history ON live_session(user_id,occurred_at DESC,id DESC);
CREATE TABLE live_session_exercise (
 user_id uuid NOT NULL, session_id uuid NOT NULL, id uuid NOT NULL, exercise_id uuid NOT NULL,
 exercise_name varchar(100) NOT NULL, rest_seconds integer NOT NULL CHECK(rest_seconds BETWEEN 30 AND 600),
 position integer NOT NULL CHECK(position>=0), PRIMARY KEY(user_id,session_id,id),
 UNIQUE(user_id,id), UNIQUE(user_id,session_id,position),
 FOREIGN KEY(user_id,session_id) REFERENCES live_session(user_id,id),
 FOREIGN KEY(user_id,exercise_id) REFERENCES live_exercise(user_id,id)
);
CREATE TABLE live_set (
 user_id uuid NOT NULL, session_id uuid NOT NULL, session_exercise_id uuid NOT NULL, id uuid NOT NULL,
 position integer NOT NULL CHECK(position>=0), weight_kg numeric(7,3) CHECK(weight_kg BETWEEN 0 AND 1000),
 reps integer CHECK(reps BETWEEN 0 AND 10000), completed boolean NOT NULL, warmup boolean NOT NULL,
 rpe numeric(3,1) CHECK(rpe BETWEEN 6 AND 10 AND mod(rpe,0.5)=0),
 PRIMARY KEY(user_id,session_id,id), UNIQUE(user_id,id),
 UNIQUE(user_id,session_id,session_exercise_id,position),
 FOREIGN KEY(user_id,session_id,session_exercise_id) REFERENCES live_session_exercise(user_id,session_id,id)
);
CREATE TABLE training_mutation (
 user_id uuid NOT NULL REFERENCES app_user(id), mutation_id uuid NOT NULL,
 request_sha256 char(64) NOT NULL, resource_type varchar(32) NOT NULL, resource_id uuid NOT NULL,
 response_status smallint NOT NULL, response_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,mutation_id)
);
