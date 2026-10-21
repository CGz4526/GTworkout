package io.github.cgz4526.workout;

import io.github.cgz4526.workout.training.TrainingMapper;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Explicit synthetic closed-loop sample; not part of the normal verification test suite. */
public class P4LoadProbe extends TestApplicationProcess {
  record Size(String name, int sessions, int exercises, int sets) {}

  record Sample(double milliseconds, boolean success) {}

  public static void main(String[] args) throws Exception {
    new P4LoadProbe().run();
  }

  void check(boolean valid, String reason) {
    if (!valid) throw new IllegalStateException(reason);
  }

  void run() throws Exception {
    String runId = UUID.randomUUID().toString();
    var directory = Path.of("target", "p4-load-" + runId);
    Files.createDirectories(directory);
    var report = new LinkedHashMap<String, Object>();
    var datasets = new ArrayList<Map<String, Object>>();
    report.put("runId", runId);
    report.put("timestampUtc", Instant.now().toString());
    report.put("java", System.getProperty("java.version"));
    report.put("os", System.getProperty("os.name"));
    report.put("hostLogicalProcessors", Runtime.getRuntime().availableProcessors());
    report.put("serverMaxHeapMiB", 256);
    report.put("requestsPerLevel", 64);
    report.put("warmupRequestsPerDataset", 5);
    report.put(
        "method",
        "one user, closed-loop HTTP statistics reads, warm caches, concurrency 1/2/4/8; model"
            + " disabled; not production capacity");
    report.put("datasets", datasets);
    Process process = null;
    try (var database =
        new PostgreSQLContainer(
                DockerImageName.parse(
                        "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
                    .asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("p4_load")
            .withUsername("load_test")
            .withPassword(UUID.randomUUID().toString())) {
      database.start();
      process = start(database, "p4-load-" + runId + "/application.log");
      String password = UUID.randomUUID().toString();
      var account =
          request(
              "/api/v1/auth/register",
              "POST",
              "application/json",
              json.writeValueAsBytes(Map.of("username", "load_synthetic", "password", password)),
              Map.of("X-CSRF-TOKEN", csrf()));
      check(account.statusCode() == 201, "Synthetic registration failed");
      String user = json.readTree(account.body()).path("id").asText();
      check(
          request(
                      "/api/v1/auth/login",
                      "POST",
                      "application/x-www-form-urlencoded",
                      ("username=load_synthetic&password=" + password)
                          .getBytes(StandardCharsets.UTF_8),
                      Map.of("X-CSRF-TOKEN", csrf()))
                  .statusCode()
              == 200,
          "Synthetic login failed");
      try (var observer =
          DriverManager.getConnection(
              database.getJdbcUrl(), database.getUsername(), database.getPassword())) {
        for (var size :
            List.of(
                new Size("small", 30, 4, 3),
                new Size("medium", 365, 6, 4),
                new Size("large", 2000, 8, 5))) {
          byte[] raw = fixture(size);
          long start = System.nanoTime();
          var uploaded = upload(raw, user);
          String backup = uploaded.path("id").asText(), job = uploaded.path("jobId").asText();
          long deadline = System.nanoTime() + Duration.ofSeconds(90).toNanos();
          String status;
          do {
            status = scalar(observer, "SELECT status FROM background_job WHERE id=?", job);
            if ("FAILED".equals(status))
              throw new IllegalStateException("Synthetic projection failed");
            if ("SUCCEEDED".equals(status)) break;
            Thread.sleep(100);
          } while (System.nanoTime() < deadline);
          check("SUCCEEDED".equals(status), "Projection timeout");
          double readySeconds = (System.nanoTime() - start) / 1_000_000_000.0;
          try (var s = observer.createStatement()) {
            s.execute("ANALYZE snapshot_session, snapshot_session_exercise, snapshot_set");
          }
          savePlan(observer, backup, directory.resolve(size.name() + "-summary-plan.txt"));
          long expected = (long) size.sessions() * size.exercises() * size.sets() * 400;
          String path = "/api/v1/backups/" + backup + "/statistics";
          for (int i = 0; i < 5; i++)
            check(sample(path, expected).success(), "Warm-up result mismatch");
          var levels = new ArrayList<Map<String, Object>>();
          for (int concurrency : List.of(1, 2, 4, 8)) {
            var pool = Executors.newFixedThreadPool(concurrency);
            var measurements = new ArrayList<Sample>();
            long began = System.nanoTime();
            try {
              var tasks = new ArrayList<Callable<Sample>>();
              for (int i = 0; i < 64; i++) tasks.add(() -> sample(path, expected));
              for (var future : pool.invokeAll(tasks)) measurements.add(future.get());
            } finally {
              pool.shutdownNow();
            }
            double elapsed = (System.nanoTime() - began) / 1_000_000_000.0;
            var times = measurements.stream().mapToDouble(Sample::milliseconds).sorted().toArray();
            long failures = measurements.stream().filter(s -> !s.success()).count();
            levels.add(
                Map.of(
                    "concurrency",
                    concurrency,
                    "requests",
                    64,
                    "failures",
                    failures,
                    "p50Ms",
                    times[31],
                    "p95Ms",
                    times[60],
                    "maxMs",
                    times[63],
                    "requestsPerSecond",
                    64 / elapsed,
                    "elapsedSeconds",
                    elapsed,
                    "samples",
                    List.copyOf(measurements)));
            System.out.println(
                "LOAD "
                    + size.name()
                    + " concurrency="
                    + concurrency
                    + " failures="
                    + failures
                    + " p95Ms="
                    + Math.round(times[60]));
            check(failures == 0, "Load sample contained failures");
          }
          datasets.add(
              Map.of(
                  "name",
                  size.name(),
                  "sessions",
                  size.sessions(),
                  "exercisesPerSession",
                  size.exercises(),
                  "setsPerExercise",
                  size.sets(),
                  "setRows",
                  (long) size.sessions() * size.exercises() * size.sets(),
                  "rawBytes",
                  raw.length,
                  "expectedVolume",
                  expected,
                  "uploadToReadySeconds",
                  readySeconds,
                  "levels",
                  levels));
          Files.writeString(directory.resolve("result.json"), json.writeValueAsString(report));
        }
        report.put("result", "PASS");
        Files.writeString(directory.resolve("result.json"), json.writeValueAsString(report));
        System.out.println("LOAD PASS: evidence at " + directory);
      }
    } finally {
      if (process != null && process.isAlive())
        process.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
    }
  }

  private Sample sample(String path, long expected) {
    long start = System.nanoTime();
    boolean success = false;
    try {
      var response = request(path, "GET", null, null, Map.of());
      success =
          response.statusCode() == 200
              && json.readTree(response.body()).path("summary").path("volume").asLong() == expected;
    } catch (Exception ex) {
      /* Count every failed request; do not turn errors into successful timing samples. */
    }
    return new Sample((System.nanoTime() - start) / 1_000_000.0, success);
  }

  private tools.jackson.databind.JsonNode upload(byte[] raw, String user) throws Exception {
    String boundary = "LoadBoundary";
    var body = new ByteArrayOutputStream();
    body.write(
        ("--"
                + boundary
                + "\r\nContent-Disposition: form-data; name=\"timezone\"\r\n\r\nAsia/Shanghai\r\n--"
                + boundary
                + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"synthetic.json\"\r\n"
                + "Content-Type: application/json\r\n\r\n")
            .getBytes(StandardCharsets.UTF_8));
    body.write(raw);
    body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    var result =
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
    check(result.statusCode() == 202, "Synthetic upload failed with HTTP " + result.statusCode());
    return json.readTree(result.body());
  }

  private byte[] fixture(Size size) {
    var exercises = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < size.exercises(); i++)
      exercises.add(
          Map.of("id", "ex" + i, "name", "Synthetic exercise " + i, "bodyPart", "part" + i));
    var sessions = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < size.sessions(); i++) {
      var items = new ArrayList<Map<String, Object>>();
      for (int e = 0; e < size.exercises(); e++) {
        var sets = new ArrayList<Map<String, Object>>();
        for (int g = 0; g < size.sets(); g++)
          sets.add(Map.of("completed", true, "weight", 40, "reps", 10));
        items.add(Map.of("exerciseId", "ex" + e, "sets", sets));
      }
      sessions.add(
          Map.of(
              "id",
              "s" + i,
              "date",
              LocalDate.of(2020, 1, 1)
                  .plusDays(i)
                  .atTime(12, 0)
                  .toInstant(ZoneOffset.UTC)
                  .toString(),
              "finished",
              true,
              "duration",
              1800,
              "exercises",
              items));
    }
    return json.writeValueAsBytes(
        Map.of(
            "version",
            3,
            "exercises",
            exercises,
            "templates",
            List.of(),
            "sessions",
            sessions,
            "weights",
            List.of()));
  }

  private void savePlan(Connection connection, String backup, Path path) throws Exception {
    String script =
        String.join(
            " ",
            TrainingMapper.class
                .getMethod("summary", String.class, LocalDate.class, LocalDate.class)
                .getAnnotation(Select.class)
                .value());
    var parameters = new HashMap<String, Object>();
    parameters.put("backupId", backup);
    parameters.put("from", null);
    parameters.put("to", null);
    var bound =
        new XMLLanguageDriver()
            .createSqlSource(new Configuration(), script, Map.class)
            .getBoundSql(parameters);
    try (var statement =
        connection.prepareStatement("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + bound.getSql())) {
      statement.setQueryTimeout(10);
      for (int i = 0; i < bound.getParameterMappings().size(); i++) {
        if (bound.getParameterMappings().get(i).getProperty().equals("backupId"))
          statement.setString(i + 1, backup);
        else statement.setNull(i + 1, Types.DATE);
      }
      var lines = new ArrayList<String>();
      try (var rows = statement.executeQuery()) {
        while (rows.next()) lines.add(rows.getString(1));
      }
      Files.write(path, lines, StandardCharsets.UTF_8);
    }
  }
}
