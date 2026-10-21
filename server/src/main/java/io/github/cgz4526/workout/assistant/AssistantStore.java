package io.github.cgz4526.workout.assistant;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AssistantStore {
  public record Run(
      String id,
      String userId,
      String backupId,
      String fingerprint,
      String requestJson,
      String model,
      String status,
      String executionToken,
      Instant deadlineAt,
      String errorCode,
      String resultJson,
      int modelCalls,
      int toolCalls,
      long totalTokens) {}

  public record Draft(String id, String status, int version, String payloadJson) {}

  private final JdbcTemplate jdbc;

  public AssistantStore(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private Run row(ResultSet r, int n) throws SQLException {
    var deadline = r.getTimestamp("deadline_at");
    return new Run(
        r.getString("id"),
        r.getString("user_id"),
        r.getString("backup_id"),
        r.getString("fingerprint"),
        r.getString("request_json"),
        r.getString("model"),
        r.getString("status"),
        r.getString("execution_token"),
        deadline == null ? null : deadline.toInstant(),
        r.getString("error_code"),
        r.getString("result_json"),
        r.getInt("model_calls"),
        r.getInt("tool_calls"),
        r.getLong("total_tokens"));
  }

  private Run first(List<Run> rows) {
    return rows.isEmpty() ? null : rows.get(0);
  }

  Run get(String user, String id) {
    return first(
        jdbc.query(
            "SELECT * FROM agent_run WHERE user_id=?::uuid AND id=?::uuid", this::row, user, id));
  }

  Run replay(String user, String key) {
    return first(
        jdbc.query(
            "SELECT * FROM agent_run WHERE user_id=?::uuid AND idempotency_key=?::uuid",
            this::row,
            user,
            key));
  }

  boolean quota(String user) {
    var counts =
        jdbc.queryForMap(
            "SELECT count(*) AS total, count(*) FILTER (WHERE created_at >="
                + " date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS"
                + " daily, count(*) FILTER (WHERE status IN ('PENDING','RUNNING')) AS active FROM"
                + " agent_run WHERE user_id=?::uuid",
            user);
    return ((Number) counts.get("total")).longValue() >= 100
        || ((Number) counts.get("daily")).longValue() >= 20
        || ((Number) counts.get("active")).longValue() > 0;
  }

  void insert(
      String id, String user, String key, CoachRequest request, String fingerprint, String model) {
    jdbc.update(
        "INSERT INTO agent_run(id,user_id,backup_id,idempotency_key,request_json,fingerprint,model)"
            + " VALUES(?::uuid,?::uuid,?::uuid,?::uuid,?,?,?)",
        id,
        user,
        request.backupId(),
        key,
        AssistantJson.JSON.writeValueAsString(request),
        fingerprint,
        model);
  }

  Run claim() {
    return first(
        jdbc.query(
            """
WITH candidate AS (SELECT id FROM agent_run WHERE status='PENDING' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
UPDATE agent_run r SET status='RUNNING', execution_token=?::uuid, deadline_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
FROM candidate c WHERE r.id=c.id RETURNING r.*
""",
            this::row,
            UUID.randomUUID().toString()));
  }

  int recover() {
    return jdbc.update(
        "UPDATE agent_run SET"
            + " status='FAILED',error_code='MODEL_OUTCOME_UNKNOWN',execution_token=NULL,deadline_at=NULL,updated_at=clock_timestamp()"
            + " WHERE status='RUNNING' AND deadline_at<=clock_timestamp()");
  }

  int usage(Run run, CoachEngine.Usage usage) {
    return jdbc.update(
        "UPDATE agent_run SET"
            + " model_calls=?,tool_calls=?,total_tokens=?,updated_at=clock_timestamp() WHERE"
            + " id=?::uuid AND execution_token=?::uuid AND status='RUNNING' AND"
            + " deadline_at>clock_timestamp()",
        usage.modelCalls(),
        usage.toolCalls(),
        usage.totalTokens(),
        run.id(),
        run.executionToken());
  }

  int complete(Run run, String result) {
    return jdbc.update(
        "UPDATE agent_run SET"
            + " status='SUCCEEDED',result_json=?,execution_token=NULL,deadline_at=NULL,updated_at=clock_timestamp()"
            + " WHERE id=?::uuid AND execution_token=?::uuid AND status='RUNNING' AND"
            + " deadline_at>clock_timestamp()",
        result,
        run.id(),
        run.executionToken());
  }

  void failed(Run run, String code) {
    jdbc.update(
        "UPDATE agent_run SET"
            + " status='FAILED',error_code=?,execution_token=NULL,deadline_at=NULL,updated_at=clock_timestamp()"
            + " WHERE id=?::uuid AND execution_token=?::uuid AND status='RUNNING'",
        code,
        run.id(),
        run.executionToken());
  }

  void insertDraft(String id, Run run, String payload) {
    jdbc.update(
        "INSERT INTO plan_draft(id,user_id,run_id,payload_json) VALUES(?::uuid,?::uuid,?::uuid,?)",
        id,
        run.userId(),
        run.id(),
        payload);
  }

  Draft draft(String user, String id, boolean lock) {
    var rows =
        jdbc.query(
            "SELECT id::text,status,version,payload_json FROM plan_draft WHERE user_id=?::uuid AND"
                + " id=?::uuid"
                + (lock ? " FOR UPDATE" : ""),
            (r, n) -> new Draft(r.getString(1), r.getString(2), r.getInt(3), r.getString(4)),
            user,
            id);
    return rows.isEmpty() ? null : rows.get(0);
  }

  void confirm(String user, String id, int version) {
    if (jdbc.update(
            "UPDATE plan_draft SET status='CONFIRMED',version=2,confirmed_at=clock_timestamp()"
                + " WHERE user_id=?::uuid AND id=?::uuid AND status='DRAFT' AND version=?",
            user,
            id,
            version)
        != 1) throw new IllegalStateException();
  }
}
