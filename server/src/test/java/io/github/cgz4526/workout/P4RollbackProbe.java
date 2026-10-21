package io.github.cgz4526.workout;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Explicit backend-only forward/back compatibility probe over an isolated V4 database. */
public class P4RollbackProbe extends TestApplicationProcess {
  public static void main(String[] args) throws Exception {
    if (args.length != 1)
      throw new IllegalArgumentException("Pass the local historical P2 JAR path.");
    new P4RollbackProbe().run(Path.of(args[0]).toAbsolutePath());
  }

  void check(boolean valid, String reason) {
    if (!valid) throw new IllegalStateException(reason);
  }

  void run(Path oldJar) throws Exception {
    check(Files.isRegularFile(oldJar), "Historical JAR is missing");
    String runId = UUID.randomUUID().toString();
    var directory = Path.of("target", "p4-rollback-" + runId);
    Files.createDirectories(directory);
    var report = new LinkedHashMap<String, Object>();
    report.put("runId", runId);
    report.put("timestampUtc", Instant.now().toString());
    report.put(
        "oldJarSha256",
        HexFormat.of()
            .formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(oldJar))));
    report.put(
        "scope", "isolated synthetic backend P3 -> P2 -> P3; V4 database retained, model disabled");
    Process process = null;
    try (var database =
        new PostgreSQLContainer(
                DockerImageName.parse(
                        "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
                    .asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("p4_rollback")
            .withUsername("rollback_test")
            .withPassword(UUID.randomUUID().toString())) {
      database.start();
      process = start(database, "p4-rollback-" + runId + "/current-before.log");
      String password = UUID.randomUUID().toString();
      var account =
          request(
              "/api/v1/auth/register",
              "POST",
              "application/json",
              json.writeValueAsBytes(
                  Map.of("username", "rollback_synthetic", "password", password)),
              Map.of("X-CSRF-TOKEN", csrf()));
      check(account.statusCode() == 201, "Registration failed");
      String user = json.readTree(account.body()).path("id").asText();
      check(
          request(
                      "/api/v1/auth/login",
                      "POST",
                      "application/x-www-form-urlencoded",
                      ("username=rollback_synthetic&password=" + password)
                          .getBytes(StandardCharsets.UTF_8),
                      Map.of("X-CSRF-TOKEN", csrf()))
                  .statusCode()
              == 200,
          "Login failed");
      byte[] raw =
          json.writeValueAsBytes(
              json.readTree(getClass().getResourceAsStream("/contracts/training-cases.json"))
                  .path("cases")
                  .get(0)
                  .path("backup"));
      String boundary = "RollbackBoundary";
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
                  + "Content-Disposition: form-data; name=\"file\"; filename=\"synthetic.json\"\r\n"
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
                  user));
      check(uploaded.statusCode() == 202, "Upload failed");
      var meta = json.readTree(uploaded.body());
      String backup = meta.path("id").asText(), job = meta.path("jobId").asText();
      try (var observer =
          DriverManager.getConnection(
              database.getJdbcUrl(), database.getUsername(), database.getPassword())) {
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (!"SUCCEEDED"
                .equals(scalar(observer, "SELECT status FROM background_job WHERE id=?", job))
            && System.nanoTime() < deadline) Thread.sleep(100);
        check(
            "SUCCEEDED"
                .equals(scalar(observer, "SELECT status FROM background_job WHERE id=?", job)),
            "Projection timeout");
        String run = UUID.randomUUID().toString(), draft = UUID.randomUUID().toString();
        // A declared synthetic fixture checks that old code preserves P3 resources.
        try (var s =
            observer.prepareStatement(
                "INSERT INTO"
                    + " agent_run(id,user_id,backup_id,idempotency_key,fingerprint,request_json,model,status)"
                    + " VALUES(?::uuid,?::uuid,?::uuid,?::uuid,?,?,?,'SUCCEEDED')")) {
          s.setString(1, run);
          s.setString(2, user);
          s.setString(3, backup);
          s.setString(4, UUID.randomUUID().toString());
          s.setString(5, "0".repeat(64));
          s.setString(6, "{}");
          s.setString(7, "synthetic-rollback-fixture");
          s.executeUpdate();
        }
        String payload =
            json.writeValueAsString(
                Map.of(
                    "schemaVersion",
                    1,
                    "templates",
                    List.of(
                        Map.of(
                            "id",
                            "ai-plan-" + draft + "-0",
                            "name",
                            "Synthetic preserved plan",
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
                    "persistence-only synthetic fixture"));
        try (var s =
            observer.prepareStatement(
                "INSERT INTO plan_draft(id,user_id,run_id,status,version,payload_json,confirmed_at)"
                    + " VALUES(?::uuid,?::uuid,?::uuid,'CONFIRMED',2,?,clock_timestamp())")) {
          s.setString(1, draft);
          s.setString(2, user);
          s.setString(3, run);
          s.setString(4, payload);
          s.executeUpdate();
        }
        process.destroy();
        check(process.waitFor(15, TimeUnit.SECONDS), "Current JVM did not stop");
        process = start(database, "p4-rollback-" + runId + "/historical-p2.log", oldJar);
        var oldStatus = request("/api/status", "GET", null, null, Map.of());
        check(
            oldStatus.statusCode() == 200
                && "P2".equals(json.readTree(oldStatus.body()).path("stage").asText()),
            "Historical P2 did not become ready");
        verifyBackup(backup, raw, user);
        check(
            "1".equals(scalar(observer, "SELECT count(*) FROM plan_draft WHERE id=?", draft)),
            "P3 draft disappeared under P2");
        process.destroy();
        check(process.waitFor(15, TimeUnit.SECONDS), "Historical JVM did not stop");
        process = start(database, "p4-rollback-" + runId + "/current-after.log");
        var status = request("/api/status", "GET", null, null, Map.of());
        check(
            status.statusCode() == 200
                && "P3".equals(json.readTree(status.body()).path("stage").asText()),
            "Current version failed to resume");
        verifyBackup(backup, raw, user);
        var restored = request("/api/v1/plan-drafts/" + draft, "GET", null, null, Map.of());
        check(
            restored.statusCode() == 200
                && payload.equals(json.readTree(restored.body()).path("payload").toString()),
            "Draft was not retained across versions");
        try (var s = observer.createStatement();
            var rows =
                s.executeQuery(
                    "SELECT max(version::integer) FROM flyway_schema_history WHERE success")) {
          rows.next();
          check(rows.getInt(1) == 4, "Database schema changed unexpectedly");
        }
        report.put("result", "PASS");
        report.put("databaseVersion", 4);
        report.put("backupVolume", 770);
        report.put("confirmedDraftRetained", true);
        System.out.println("ROLLBACK PASS: P3 -> P2 -> P3, evidence at " + directory);
      }
    } catch (Exception ex) {
      report.put("result", "FAILED");
      report.put("errorType", ex.getClass().getSimpleName());
      throw ex;
    } finally {
      if (process != null && process.isAlive())
        process.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
      Files.writeString(directory.resolve("result.json"), json.writeValueAsString(report));
    }
  }

  private void verifyBackup(String backup, byte[] raw, String user) throws Exception {
    var me = request("/api/v1/auth/me", "GET", null, null, Map.of());
    check(
        me.statusCode() == 200 && user.equals(json.readTree(me.body()).path("id").asText()),
        "Session did not survive version change");
    var downloaded =
        request("/api/v1/backups/" + backup + "/download", "GET", null, null, Map.of());
    check(
        downloaded.statusCode() == 200 && Arrays.equals(downloaded.body(), raw),
        "Backup bytes changed");
    var stats = request("/api/v1/backups/" + backup + "/statistics", "GET", null, null, Map.of());
    check(
        stats.statusCode() == 200
            && json.readTree(stats.body()).path("summary").path("volume").asInt() == 770,
        "Statistics changed");
  }
}
