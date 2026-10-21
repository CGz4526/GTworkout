package io.github.cgz4526.workout;

import static org.assertj.core.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

/** Cold restoration to a new database and JVM, not a restart of the original service. */
class P4RecoveryIT extends TestApplicationProcess {
  private PostgreSQLContainer database(String name) {
    return new PostgreSQLContainer(
            DockerImageName.parse(
                    "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
                .asCompatibleSubstituteFor("postgres"))
        .withDatabaseName(name)
        .withUsername("recovery_test")
        .withPassword(UUID.randomUUID().toString());
  }

  @Test
  void coldArchiveRestorePreservesApplicationDataAuthenticationAndDrafts() throws Exception {
    String runId = UUID.randomUUID().toString();
    var directory = Path.of("target", "p4-recovery-" + runId);
    Files.createDirectories(directory);
    var timer = System.nanoTime();
    Process first = null, restored = null;
    try (var source = database("p4_source");
        var target = database("p4_restored")) {
      source.start();
      String userId,
          backupId,
          jobId,
          draftId = UUID.randomUUID().toString(),
          finishedRunId = UUID.randomUUID().toString(),
          expiredRunId = UUID.randomUUID().toString();
      String password = UUID.randomUUID().toString(), username = "restore_" + runId.substring(0, 8);
      byte[] raw =
          json.writeValueAsBytes(
              json.readTree(getClass().getResourceAsStream("/contracts/training-cases.json"))
                  .path("cases")
                  .get(0)
                  .path("backup"));
      try (var observer =
          DriverManager.getConnection(
              source.getJdbcUrl(), source.getUsername(), source.getPassword())) {
        first = start(source, "p4-recovery-" + runId + "/source.log");
        var registration =
            request(
                "/api/v1/auth/register",
                "POST",
                "application/json",
                json.writeValueAsBytes(Map.of("username", username, "password", password)),
                Map.of("X-CSRF-TOKEN", csrf()));
        assertThat(registration.statusCode()).isEqualTo(201);
        userId = json.readTree(registration.body()).path("id").asText();
        login(username, password);
        String boundary = "P4SyntheticBoundary";
        var body = new ByteArrayOutputStream();
        body.write(
            ("--"
                    + boundary
                    + "\r\n"
                    + "Content-Disposition: form-data; name=\"timezone\"\r\n\r\n"
                    + "Asia/Shanghai\r\n"
                    + "--"
                    + boundary
                    + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\";"
                    + " filename=\"synthetic.json\"\r\n"
                    + "Content-Type: application/json\r\n\r\n")
                .getBytes(StandardCharsets.UTF_8));
        body.write(raw);
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        var uploaded =
            request(
                "/api/v1/backups",
                "POST",
                "multipart/form-data; boundary=" + boundary,
                body.toByteArray(),
                Map.of(
                    "X-CSRF-TOKEN",
                    csrf(),
                    "Idempotency-Key",
                    UUID.randomUUID().toString(),
                    "X-Expected-User",
                    userId));
        assertThat(uploaded.statusCode()).isEqualTo(202);
        var meta = json.readTree(uploaded.body());
        backupId = meta.path("id").asText();
        jobId = meta.path("jobId").asText();
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (!"SUCCEEDED"
                .equals(scalar(observer, "SELECT status FROM background_job WHERE id=?", jobId))
            && System.nanoTime() < deadline) Thread.sleep(100);
        assertThat(scalar(observer, "SELECT status FROM background_job WHERE id=?", jobId))
            .isEqualTo("SUCCEEDED");

        // This is an explicit persistence fixture, not a fabricated live model response.
        // Confirmation itself still goes through the real authenticated HTTP business API.
        var payload =
            Map.of(
                "schemaVersion",
                1,
                "templates",
                List.of(
                    Map.of(
                        "id",
                        "ai-plan-" + draftId + "-0",
                        "name",
                        "Synthetic restored plan",
                        "items",
                        List.of(
                            Map.of(
                                "exerciseId",
                                "squat",
                                "exerciseName",
                                "深蹲",
                                "defaultSets",
                                3,
                                "defaultReps",
                                10,
                                "restSeconds",
                                90)))),
                "estimatedMinutes",
                List.of(12),
                "estimateAssumptions",
                "synthetic fixture, not model generation");
        seedFinishedDraft(
            observer, userId, backupId, finishedRunId, draftId, json.writeValueAsString(payload));
        var confirmed =
            request(
                "/api/v1/plan-drafts/" + draftId + "/confirm",
                "POST",
                "application/json",
                "{\"version\":1}".getBytes(StandardCharsets.UTF_8),
                Map.of("X-CSRF-TOKEN", csrf()));
        assertThat(confirmed.statusCode()).isEqualTo(200);
        assertThat(json.readTree(confirmed.body()).path("version").asInt()).isEqualTo(2);
        assertThat(request("/api/v1/auth/me", "GET", null, null, Map.of()).statusCode())
            .isEqualTo(200);
        first.destroy();
        assertThat(first.waitFor(15, TimeUnit.SECONDS)).isTrue();
        // Seed the interrupted task only after stopping the source JVM, so only the
        // restored application's scheduler can perform recovery.
        seedExpiredRun(observer, userId, backupId, expiredRunId);
      }
      var dump =
          source.execInContainer(
              "pg_dump",
              "-U",
              source.getUsername(),
              "-d",
              source.getDatabaseName(),
              "--format=custom",
              "--no-owner",
              "--no-privileges",
              "--file=/tmp/p4.dump");
      assertThat(dump.getExitCode()).as("pg_dump exit code").isZero();
      var archive = directory.resolve("workout.dump").toAbsolutePath();
      source.copyFileFromContainer("/tmp/p4.dump", archive.toString());
      assertThat(Files.size(archive)).isGreaterThan(0);

      target.start();
      assertThat(target.getContainerId()).isNotEqualTo(source.getContainerId());
      assertThat(target.getJdbcUrl()).isNotEqualTo(source.getJdbcUrl());
      target.copyFileToContainer(MountableFile.forHostPath(archive), "/tmp/p4.dump");
      var restore =
          target.execInContainer(
              "pg_restore",
              "--exit-on-error",
              "--no-owner",
              "--no-privileges",
              "-U",
              target.getUsername(),
              "-d",
              target.getDatabaseName(),
              "/tmp/p4.dump");
      assertThat(restore.getExitCode()).as("pg_restore exit code").isZero();

      try (var observer =
          DriverManager.getConnection(
              target.getJdbcUrl(), target.getUsername(), target.getPassword())) {
        assertThat(
                scalar(
                    observer, "SELECT projection_status FROM backup_snapshot WHERE id=?", backupId))
            .isEqualTo("READY");
        assertThat(
                scalar(
                    observer, "SELECT count(*) FROM snapshot_session WHERE backup_id=?", backupId))
            .isEqualTo("6");
        assertThat(scalar(observer, "SELECT status FROM agent_run WHERE id=?", expiredRunId))
            .isEqualTo("RUNNING");
        assertThat(scalar(observer, "SELECT version FROM plan_draft WHERE id=?", draftId))
            .isEqualTo("2");
        restored = start(target, "p4-recovery-" + runId + "/restored.log");
        var status = request("/api/status", "GET", null, null, Map.of());
        assertThat(status.statusCode()).isEqualTo(200);
        assertThat(json.readTree(status.body()).path("capabilities").path("assistant").asBoolean())
            .isFalse();

        // The exact session cookie from the original JVM is retained by this harness.
        var me = request("/api/v1/auth/me", "GET", null, null, Map.of());
        assertThat(me.statusCode()).isEqualTo(200);
        assertThat(json.readTree(me.body()).path("id").asText()).isEqualTo(userId);
        var downloaded =
            request("/api/v1/backups/" + backupId + "/download", "GET", null, null, Map.of());
        assertThat(downloaded.statusCode()).isEqualTo(200);
        assertThat(downloaded.body()).isEqualTo(raw);
        var statistics =
            request("/api/v1/backups/" + backupId + "/statistics", "GET", null, null, Map.of());
        assertThat(statistics.statusCode()).isEqualTo(200);
        assertThat(json.readTree(statistics.body()).path("summary").path("volume").asInt())
            .isEqualTo(770);
        var draft = request("/api/v1/plan-drafts/" + draftId, "GET", null, null, Map.of());
        assertThat(draft.statusCode()).isEqualTo(200);
        assertThat(json.readTree(draft.body()).path("status").asText()).isEqualTo("CONFIRMED");
        var replay =
            request(
                "/api/v1/plan-drafts/" + draftId + "/confirm",
                "POST",
                "application/json",
                "{\"version\":1}".getBytes(StandardCharsets.UTF_8),
                Map.of("X-CSRF-TOKEN", csrf()));
        assertThat(replay.statusCode()).isEqualTo(200);
        assertThat(json.readTree(replay.body())).isEqualTo(json.readTree(draft.body()));
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!"FAILED"
                .equals(scalar(observer, "SELECT status FROM agent_run WHERE id=?", expiredRunId))
            && System.nanoTime() < deadline) Thread.sleep(100);
        assertThat(scalar(observer, "SELECT error_code FROM agent_run WHERE id=?", expiredRunId))
            .isEqualTo("MODEL_OUTCOME_UNKNOWN");
        assertThat(scalar(observer, "SELECT model_calls FROM agent_run WHERE id=?", expiredRunId))
            .isEqualTo("1");
        assertThat(scalar(observer, "SELECT count(*) FROM plan_draft WHERE run_id=?", expiredRunId))
            .isEqualTo("0");

        assertThat(
                request("/api/v1/auth/logout", "POST", null, null, Map.of("X-CSRF-TOKEN", csrf()))
                    .statusCode())
            .isEqualTo(204);
        assertThat(request("/api/v1/auth/me", "GET", null, null, Map.of()).statusCode())
            .isEqualTo(401);
        var fresh = new TestApplicationProcess();
        fresh.port = port;
        var loggedIn =
            fresh.request(
                "/api/v1/auth/login",
                "POST",
                "application/x-www-form-urlencoded",
                ("username=" + username + "&password=" + password).getBytes(StandardCharsets.UTF_8),
                Map.of("X-CSRF-TOKEN", fresh.csrf()));
        assertThat(loggedIn.statusCode()).isEqualTo(200);
        assertThat(
                json.readTree(fresh.request("/api/v1/auth/me", "GET", null, null, Map.of()).body())
                    .path("id")
                    .asText())
            .isEqualTo(userId);
        assertThat(
                fresh
                    .request(
                        "/api/v1/backups/" + backupId + "/download", "GET", null, null, Map.of())
                    .body())
            .isEqualTo(raw);

        var evidence =
            Map.of(
                "result",
                "PASS",
                "runId",
                runId,
                "timestampUtc",
                Instant.now().toString(),
                "scope",
                "synthetic cold logical restore to a different PostgreSQL and JVM; no live model"
                    + " calls",
                "dumpBytes",
                Files.size(archive),
                "dumpSha256",
                HexFormat.of()
                    .formatHex(
                        MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(archive))),
                "sourceAndTargetDifferent",
                true,
                "volume",
                770,
                "durationSeconds",
                (System.nanoTime() - timer) / 1_000_000_000.0);
        Files.writeString(directory.resolve("result.json"), json.writeValueAsString(evidence));
      }
    } finally {
      if (first != null && first.isAlive()) first.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
      if (restored != null && restored.isAlive())
        restored.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
    }
  }

  private void login(String username, String password) throws Exception {
    assertThat(
            request(
                    "/api/v1/auth/login",
                    "POST",
                    "application/x-www-form-urlencoded",
                    ("username=" + username + "&password=" + password)
                        .getBytes(StandardCharsets.UTF_8),
                    Map.of("X-CSRF-TOKEN", csrf()))
                .statusCode())
        .isEqualTo(200);
  }

  private void seedFinishedDraft(
      Connection connection, String user, String backup, String run, String draft, String payload)
      throws Exception {
    try (var s =
        connection.prepareStatement(
            "INSERT INTO"
                + " agent_run(id,user_id,backup_id,idempotency_key,fingerprint,request_json,model,status,result_json)"
                + " VALUES(?::uuid,?::uuid,?::uuid,?::uuid,?,?,?,'SUCCEEDED',?)")) {
      s.setString(1, run);
      s.setString(2, user);
      s.setString(3, backup);
      s.setString(4, UUID.randomUUID().toString());
      s.setString(5, "0".repeat(64));
      s.setString(6, "{}");
      s.setString(7, "synthetic-persistence-fixture");
      s.setString(8, json.writeValueAsString(Map.of("draftId", draft)));
      s.executeUpdate();
    }
    try (var s =
        connection.prepareStatement(
            "INSERT INTO plan_draft(id,user_id,run_id,payload_json)"
                + " VALUES(?::uuid,?::uuid,?::uuid,?)")) {
      s.setString(1, draft);
      s.setString(2, user);
      s.setString(3, run);
      s.setString(4, payload);
      s.executeUpdate();
    }
  }

  private void seedExpiredRun(Connection connection, String user, String backup, String run)
      throws Exception {
    try (var s =
        connection.prepareStatement(
            "INSERT INTO"
                + " agent_run(id,user_id,backup_id,idempotency_key,fingerprint,request_json,model,status,execution_token,deadline_at,model_calls)"
                + " VALUES(?::uuid,?::uuid,?::uuid,?::uuid,?,?,?,'RUNNING',?::uuid,clock_timestamp()-interval"
                + " '1 second',1)")) {
      s.setString(1, run);
      s.setString(2, user);
      s.setString(3, backup);
      s.setString(4, UUID.randomUUID().toString());
      s.setString(5, "1".repeat(64));
      s.setString(6, "{}");
      s.setString(7, "synthetic-interrupted-fixture");
      s.setString(8, UUID.randomUUID().toString());
      s.executeUpdate();
    }
  }
}
