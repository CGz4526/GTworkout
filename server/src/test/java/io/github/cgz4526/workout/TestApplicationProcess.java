package io.github.cgz4526.workout;

import static org.assertj.core.api.Assertions.*;

import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/** Shared HTTP/JVM harness; each process must use its own Testcontainers database. */
class TestApplicationProcess {
  final JsonMapper json = JsonMapper.builder().build();
  final HttpClient client =
      HttpClient.newBuilder()
          .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
          .connectTimeout(Duration.ofSeconds(2))
          .build();
  int port;

  Process start(PostgreSQLContainer database, String log) throws Exception {
    return start(database, log, Path.of("target/workout-server-0.1.0.jar"));
  }

  Process start(PostgreSQLContainer database, String log, Path jar) throws Exception {
    try (var socket = new java.net.ServerSocket(0)) {
      port = socket.getLocalPort();
    }
    var java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
    var builder =
        new ProcessBuilder(
            java,
            "-Xmx256m",
            "-jar",
            jar.toString(),
            "--server.address=127.0.0.1",
            "--server.port=" + port);
    var env = builder.environment();
    // Test JVMs must never inherit real model credentials or external datasource overrides.
    env.keySet()
        .removeIf(
            name ->
                name.startsWith("WORKOUT_DEEPSEEK_")
                    || name.startsWith("SPRING_DATASOURCE_")
                    || name.equals("SPRING_APPLICATION_JSON"));
    env.put("WORKOUT_DB_URL", database.getJdbcUrl());
    env.put("WORKOUT_DB_USER", database.getUsername());
    env.put("WORKOUT_DB_PASSWORD", database.getPassword());
    env.put("WORKOUT_REGISTRATION_ENABLED", "true");
    env.put("WORKOUT_JOBS_ENABLED", "true");
    env.put("WORKOUT_COOKIE_SECURE", "false");
    builder.redirectErrorStream(true).redirectOutput(Path.of("target", log).toFile());
    Process process = builder.start();
    long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
    try {
      while (System.nanoTime() < deadline) {
        if (!process.isAlive())
          throw new IllegalStateException("Test application exited; inspect target/" + log);
        try {
          if (request("/actuator/health/readiness", "GET", null, null, Map.of()).statusCode()
              == 200) return process;
        } catch (java.io.IOException ex) {
          /* Await startup within the bounded deadline. */
        }
        Thread.sleep(100);
      }
      process.destroyForcibly();
      throw new IllegalStateException("Test application readiness timeout");
    } catch (Exception ex) {
      if (process.isAlive()) process.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
      throw ex;
    }
  }

  HttpResponse<byte[]> request(
      String path, String method, String type, byte[] body, Map<String, String> headers)
      throws Exception {
    var request =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .timeout(Duration.ofSeconds(5));
    if (type != null) request.header("Content-Type", type);
    headers.forEach(request::header);
    request.method(
        method,
        body == null
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofByteArray(body));
    return client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
  }

  String csrf() throws Exception {
    return json.readTree(request("/api/v1/auth/csrf", "GET", null, null, Map.of()).body())
        .path("token")
        .asString();
  }

  String scalar(Connection connection, String sql, String id) throws Exception {
    try (var statement = connection.prepareStatement(sql)) {
      statement.setObject(1, UUID.fromString(id));
      try (var rows = statement.executeQuery()) {
        if (!rows.next()) return null;
        return rows.getString(1);
      }
    }
  }
}
