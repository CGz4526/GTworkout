package io.github.cgz4526.workout;

import static org.assertj.core.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Kills only its own test JVM; the current user application is never stopped. */
class P2ProcessRecoveryIT extends TestApplicationProcess {
  @Test
  void killedWorkerRollsBackThenAnotherProcessRecoversItsLease() throws Exception {
    try (var database =
        new PostgreSQLContainer(
                DockerImageName.parse(
                        "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
                    .asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("process_recovery_test")
            .withUsername("recovery_test")
            .withPassword(UUID.randomUUID().toString())) {
      database.start();
      Process first = null, second = null;
      try (var observer =
              DriverManager.getConnection(
                  database.getJdbcUrl(), database.getUsername(), database.getPassword());
          var blocker =
              DriverManager.getConnection(
                  database.getJdbcUrl(), database.getUsername(), database.getPassword())) {
        first = start(database, "p2-recovery-first.log");
        String password = UUID.randomUUID().toString();
        var registration =
            request(
                "/api/v1/auth/register",
                "POST",
                "application/json",
                json.writeValueAsBytes(Map.of("username", "recovery_user", "password", password)),
                Map.of("X-CSRF-TOKEN", csrf()));
        assertThat(registration.statusCode()).isEqualTo(201);
        String userId = json.readTree(registration.body()).path("id").asString();
        assertThat(
                request(
                        "/api/v1/auth/login",
                        "POST",
                        "application/x-www-form-urlencoded",
                        ("username=recovery_user&password=" + password)
                            .getBytes(StandardCharsets.UTF_8),
                        Map.of("X-CSRF-TOKEN", csrf()))
                    .statusCode())
            .isEqualTo(200);
        var fixture =
            json.readTree(getClass().getResourceAsStream("/contracts/training-cases.json"));
        byte[] raw = json.writeValueAsBytes(fixture.path("cases").get(0).path("backup"));
        blocker.setAutoCommit(false);
        try (var statement = blocker.createStatement()) {
          statement.execute("LOCK TABLE snapshot_session IN SHARE MODE");
        }
        String boundary = "RecoveryBoundary";
        var bytes = new ByteArrayOutputStream();
        bytes.write(
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
        bytes.write(raw);
        bytes.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        var uploaded =
            request(
                "/api/v1/backups",
                "POST",
                "multipart/form-data; boundary=" + boundary,
                bytes.toByteArray(),
                Map.of(
                    "X-CSRF-TOKEN",
                    csrf(),
                    "Idempotency-Key",
                    UUID.randomUUID().toString(),
                    "X-Expected-User",
                    userId));
        assertThat(uploaded.statusCode()).isEqualTo(202);
        var metadata = json.readTree(uploaded.body());
        String jobId = metadata.path("jobId").asString(), backupId = metadata.path("id").asString();
        long claimDeadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!"RUNNING"
                .equals(scalar(observer, "SELECT status FROM background_job WHERE id=?", jobId))
            && System.nanoTime() < claimDeadline) Thread.sleep(50);
        assertThat(scalar(observer, "SELECT status FROM background_job WHERE id=?", jobId))
            .isEqualTo("RUNNING");
        first.destroyForcibly();
        assertThat(first.waitFor(10, TimeUnit.SECONDS)).isTrue();
        blocker.rollback();
        assertThat(
                scalar(
                    observer, "SELECT count(*) FROM snapshot_session WHERE backup_id=?", backupId))
            .isEqualTo("0");
        second = start(database, "p2-recovery-second.log");
        long completionDeadline = System.nanoTime() + Duration.ofSeconds(55).toNanos();
        while (!"SUCCEEDED"
                .equals(scalar(observer, "SELECT status FROM background_job WHERE id=?", jobId))
            && System.nanoTime() < completionDeadline) Thread.sleep(200);
        assertThat(scalar(observer, "SELECT status FROM background_job WHERE id=?", jobId))
            .isEqualTo("SUCCEEDED");
        assertThat(scalar(observer, "SELECT attempts FROM background_job WHERE id=?", jobId))
            .isEqualTo("2");
        assertThat(
                scalar(
                    observer, "SELECT projection_status FROM backup_snapshot WHERE id=?", backupId))
            .isEqualTo("READY");
        assertThat(
                request("/api/v1/backups/" + backupId + "/download", "GET", null, null, Map.of())
                    .body())
            .isEqualTo(raw);
        var stats =
            request("/api/v1/backups/" + backupId + "/statistics", "GET", null, null, Map.of());
        assertThat(stats.statusCode()).isEqualTo(200);
        assertThat(json.readTree(stats.body()).path("summary").path("volume").asInt())
            .isEqualTo(770);
        String base = "/api/v1/backups/" + backupId;
        var filtered =
            request(
                base + "/statistics?from=2026-10-16&to=2026-10-16", "GET", null, null, Map.of());
        assertThat(filtered.statusCode()).isEqualTo(200);
        assertThat(json.readTree(filtered.body()).path("summary").path("trainingSessions").asInt())
            .isEqualTo(2);
        assertThat(
                request(base + "/statistics?from=2026-10-16", "GET", null, null, Map.of())
                    .statusCode())
            .isEqualTo(422);
        var page = request(base + "/sessions?limit=1", "GET", null, null, Map.of());
        assertThat(page.statusCode()).isEqualTo(200);
        assertThat(json.readTree(page.body()).path("items").size()).isEqualTo(1);
        assertThat(json.readTree(page.body()).path("hasMore").asBoolean()).isTrue();
        var exercises = request(base + "/exercises", "GET", null, null, Map.of());
        assertThat(exercises.statusCode()).isEqualTo(200);
        assertThat(json.readTree(exercises.body()).size()).isEqualTo(2);
        var progress =
            request(
                base + "/exercises/squat/progress?from=2026-10-16&to=2026-10-16",
                "GET",
                null,
                null,
                Map.of());
        assertThat(progress.statusCode()).isEqualTo(200);
        assertThat(json.readTree(progress.body()).get(0).path("volume").asInt()).isEqualTo(720);
      } finally {
        if (first != null && first.isAlive()) first.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
        if (second != null && second.isAlive())
          second.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
      }
    }
  }
}
