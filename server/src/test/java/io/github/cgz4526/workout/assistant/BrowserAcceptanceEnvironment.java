package io.github.cgz4526.workout.assistant;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.cgz4526.workout.WorkoutApplication;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.core.env.*;
import org.springframework.session.web.http.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Explicit, isolated UI fixture. It never calls a real model or the current project services. */
public class BrowserAcceptanceEnvironment {
  static final AtomicInteger SCRIPTED_CALLS = new AtomicInteger();

  @TestConfiguration(proxyBeanMethods = false)
  static class FixtureConfiguration {
    @Bean
    CookieSerializer acceptanceCookies(
        @org.springframework.beans.factory.annotation.Value("${workout.acceptance.secure-cookie:false}") boolean secure) {
      var cookies = new DefaultCookieSerializer();
      cookies.setCookieName("WORKOUT_ACCEPTANCE_" + UUID.randomUUID().toString().replace("-", ""));
      cookies.setCookiePath("/");
      cookies.setUseSecureCookie(secure);
      cookies.setUseHttpOnlyCookie(true);
      cookies.setSameSite("Lax");
      return cookies;
    }

    @Bean
    @Primary
    ModelGateway scriptedBrowserModel() {
      return new ModelGateway() {
        public boolean configured() {
          return true;
        }

        public String model() {
          return "SCRIPTED_NO_REAL_MODEL";
        }

        public Reply complete(
            List<Map<String, Object>> messages,
            List<Map<String, Object>> tools,
            boolean finalOnly,
            Duration remaining) {
          SCRIPTED_CALLS.incrementAndGet();
          if (messages.stream().noneMatch(message -> "tool".equals(message.get("role")))) {
            return new Reply(
                AssistantJson.JSON.valueToTree(
                    Map.of(
                        "role",
                        "assistant",
                        "tool_calls",
                        List.of(
                            Map.of(
                                "id",
                                "acceptance_compare",
                                "type",
                                "function",
                                "function",
                                Map.of("name", "compareTrainingPeriods", "arguments", "{}"))))),
                0);
          }
          var input = AssistantJson.parse((String) messages.get(1).get("content"));
          String action = input.path("allowedExercises").get(0).path("id").asText();
          var days = new ArrayList<Map<String, Object>>();
          for (int i = 0; i < input.path("days").asInt(); i++)
            days.add(
                Map.of(
                    "name",
                    "隔离验收计划" + (i + 1),
                    "items",
                    List.of(
                        Map.of("exerciseId", action, "sets", 3, "reps", 10, "restSeconds", 90))));
          return new Reply(
              AssistantJson.JSON.valueToTree(
                  Map.of(
                      "role",
                      "assistant",
                      "content",
                      AssistantJson.JSON.writeValueAsString(
                          Map.of("schemaVersion", 1, "days", days)))),
              0);
        }
      };
    }
  }

  private static HttpServer startWeb(int port, int backend, Path dist, Executor executor, boolean phone)
      throws IOException {
    var web = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
    var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    web.setExecutor(executor);
    web.createContext(
        "/",
        exchange -> {
          try {
            String path = exchange.getRequestURI().getPath();
            if (path.startsWith("/api/")) {
              var request =
                  HttpRequest.newBuilder(
                          URI.create("http://127.0.0.1:" + backend + exchange.getRequestURI()))
                      .timeout(Duration.ofSeconds(20));
              for (var header : exchange.getRequestHeaders().entrySet()) {
                if (!Set.of(
                        "host",
                        "connection",
                        "content-length",
                        "expect",
                        "upgrade",
                        "transfer-encoding")
                    .contains(header.getKey().toLowerCase(Locale.ROOT)))
                  for (var value : header.getValue()) request.header(header.getKey(), value);
              }
              var body = exchange.getRequestBody().readNBytes(21 * 1024 * 1024 + 1);
              if (body.length > 21 * 1024 * 1024) {
                respond(exchange, 413, new byte[0]);
                return;
              }
              request.method(
                  exchange.getRequestMethod(), HttpRequest.BodyPublishers.ofByteArray(body));
              var reply = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
              for (var header : reply.headers().map().entrySet()) {
                if (!Set.of("connection", "content-length", "transfer-encoding", "cache-control")
                    .contains(header.getKey().toLowerCase(Locale.ROOT)))
                  exchange.getResponseHeaders().put(header.getKey(), header.getValue());
              }
              exchange.getResponseHeaders().set("Cache-Control", "no-store");
              respond(exchange, reply.statusCode(), reply.body());
              return;
            }
            if (!exchange.getRequestMethod().equals("GET") || path.startsWith("/actuator")) {
              respond(exchange, 404, new byte[0]);
              return;
            }
            var file = dist.resolve(path.substring(1)).normalize();
            if (!file.startsWith(dist)) {
              respond(exchange, 404, new byte[0]);
              return;
            }
            if (!Files.isRegularFile(file)) {
              if (path.startsWith("/assets/") || path.contains(".")) {
                respond(exchange, 404, new byte[0]);
                return;
              }
              file = dist.resolve("index.html");
            }
            String name = file.getFileName().toString();
            String type =
                name.endsWith(".js")
                    ? "application/javascript"
                    : name.endsWith(".css")
                        ? "text/css"
                        : name.endsWith(".html")
                            ? "text/html; charset=utf-8"
                            : name.endsWith(".svg")
                                ? "image/svg+xml"
                                : name.endsWith(".png")
                                    ? "image/png"
                                    : name.endsWith(".webmanifest")
                                        ? "application/manifest+json"
                                        : "application/octet-stream";
            exchange.getResponseHeaders().set("Content-Type", type);
            exchange
                .getResponseHeaders()
                .set(
                    "Cache-Control",
                    path.startsWith("/assets/")
                        ? "public, max-age=31536000, immutable"
                        : "no-cache");
            var bytes = Files.readAllBytes(file);
            if (name.equals("index.html")) {
              String html = new String(bytes, java.nio.charset.StandardCharsets.UTF_8)
                  .replace("<title>健身记录</title>", "<title>Workout 隔离验收 · 模拟模型</title>");
              if (phone) html = html.replace("<body>", "<body><aside style=\"padding:10px;background:#fff3cd;color:#664d03;font:14px sans-serif\">手机验收环境：只填测试数据，不导入真实记录；本次临时云库结束后回收。</aside>");
              bytes = html.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            }
            respond(exchange, 200, bytes);
          } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            respond(exchange, 502, new byte[0]);
          } catch (Exception ex) {
            respond(exchange, 502, new byte[0]);
          } finally {
            exchange.close();
          }
        });
    web.start();
    return web;
  }

  private static void respond(HttpExchange exchange, int code, byte[] body) throws IOException {
    exchange.sendResponseHeaders(code, code == 204 ? -1 : body.length);
    if (body.length > 0) exchange.getResponseBody().write(body);
  }

  public static void main(String[] args) throws Exception {
    boolean trainingV1 = Arrays.asList(args).contains("--training-v1");
    boolean phone = Arrays.asList(args).contains("--phone-verification");
    if (phone && !trainingV1) throw new IllegalArgumentException("Phone verification requires training-v1");
    Path dist = Path.of("../dist").toAbsolutePath().normalize();
    if (!Files.isRegularFile(dist.resolve("index.html")))
      throw new IllegalStateException("Build the frontend first");
    Path evidence =
        Path.of("../.cache/browser-acceptance/isolated-" + UUID.randomUUID()).toAbsolutePath();
    Files.createDirectories(evidence);
    String image =
        "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
    try (var pg =
        new PostgreSQLContainer(DockerImageName.parse(image).asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("browser_acceptance")
            .withUsername("browser_acceptance")
            .withPassword(UUID.randomUUID().toString())) {
      pg.start();
      var properties = new HashMap<String, Object>();
      properties.put("spring.datasource.url", pg.getJdbcUrl());
      properties.put("spring.datasource.username", pg.getUsername());
      properties.put("spring.datasource.password", pg.getPassword());
      properties.put("workout.assistant.api-key", "");
      properties.put("workout.assistant.model", "");
      properties.put("workout.registration-enabled", true);
      properties.put("workout.assistant.worker-enabled", true);
      properties.put("workout.jobs.enabled", true);
      properties.put("workout.training-write-enabled", trainingV1);
      properties.put("workout.acceptance.secure-cookie", phone);
      properties.put("server.address", "127.0.0.1");
      properties.put("server.port", 0);
      properties.put("logging.level.root", "WARN");
      var environment = new StandardEnvironment();
      environment
          .getPropertySources()
          .addFirst(new MapPropertySource("isolated-browser-fixture", properties));
      try (var app =
          new SpringApplicationBuilder(WorkoutApplication.class, FixtureConfiguration.class)
              .environment(environment)
              .run()) {
        int backend = ((WebServerApplicationContext) app).getWebServer().getPort();
        var executor =
            Executors.newCachedThreadPool(
                r -> {
                  var t = new Thread(r, "acceptance-web");
                  t.setDaemon(true);
                  return t;
                });
        HttpServer web = startWeb(0, backend, dist, executor, phone);
        int port = web.getAddress().getPort();
        Files.writeString(
            evidence.resolve("ready.json"),
            AssistantJson.JSON.writeValueAsString(
                Map.of(
                    "phoneVerification", phone,
                    "lifetimeMinutes", phone ? 120 : 30,
                    "url",
                    "http://127.0.0.1:" + port,
                    "mode",
                    "SCRIPTED_NO_REAL_MODEL",
                    "realModelRequests",
                    0)));
        System.out.println("ACCEPTANCE_READY " + evidence);
        var deadline =
            Executors.newSingleThreadScheduledExecutor(
                r -> {
                  var t = new Thread(r, "acceptance-deadline");
                  t.setDaemon(true);
                  return t;
                });
        deadline.schedule(() -> System.exit(2), phone ? 120 : 30, TimeUnit.MINUTES);
        try (var input = new BufferedReader(new InputStreamReader(System.in))) {
          String command;
          while ((command = input.readLine()) != null && !command.equals("STOP")) {
            if (command.equals("PAUSE_WEB")) {
              web.stop(0);
              web = null;
              System.out.println("WEB_PAUSED");
            } else if (command.equals("RESUME_WEB") && web == null) {
              web = startWeb(port, backend, dist, executor, phone);
              System.out.println("WEB_RESUMED");
            }
          }
        } finally {
          if (web != null) web.stop(0);
          executor.shutdownNow();
          deadline.shutdownNow();
          Files.writeString(
              evidence.resolve("result.json"),
              AssistantJson.JSON.writeValueAsString(
                  Map.of(
                      "mode",
                      "SCRIPTED_NO_REAL_MODEL",
                      "scriptedModelCalls",
                      SCRIPTED_CALLS.get(),
                      "realModelRequests",
                      0)));
        }
      }
    }
  }
}
