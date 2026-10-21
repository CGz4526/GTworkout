package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.WorkoutApplication;
import io.github.cgz4526.workout.backup.*;
import io.github.cgz4526.workout.identity.IdentityService;
import io.github.cgz4526.workout.jobs.JobExecutionService;
import io.github.cgz4526.workout.shared.ApiFailure;
import io.github.cgz4526.workout.training.ProjectionHandler;
import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Explicit live probe, not an automatically executed test. Secrets are accepted only via stdin. */
public class P3LiveProbe {
  static final class LiveBudget implements ModelGateway {
    private final DeepSeekClient delegate;
    private int attempts;
    private final Path budgetFile = Path.of("../.cache/p3-live-budget.txt");

    LiveBudget(DeepSeekClient delegate) {
      this.delegate = delegate;
    }

    public boolean configured() {
      return delegate.configured();
    }

    public String model() {
      return delegate.model();
    }

    public synchronized Reply complete(
        List<Map<String, Object>> messages,
        List<Map<String, Object>> tools,
        boolean finalOnly,
        Duration remaining) {
      try (var channel =
              java.nio.channels.FileChannel.open(
                  budgetFile,
                  StandardOpenOption.CREATE,
                  StandardOpenOption.READ,
                  StandardOpenOption.WRITE);
          var lock = channel.lock()) {
        var buffer = java.nio.ByteBuffer.allocate(32);
        channel.read(buffer);
        buffer.flip();
        String text = java.nio.charset.StandardCharsets.US_ASCII.decode(buffer).toString().trim();
        attempts = text.isEmpty() ? 0 : Integer.parseInt(text);
        if (attempts >= 10) throw new ApiFailure(429, "LIVE_REQUEST_BUDGET_EXCEEDED");
        attempts++;
        channel.position(0);
        channel.truncate(0);
        channel.write(
            java.nio.ByteBuffer.wrap(
                Integer.toString(attempts).getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
        channel.force(true);
      } catch (IOException ex) {
        throw new ApiFailure(503, "LIVE_BUDGET_UNAVAILABLE");
      }
      System.out.println("LIVE model request " + attempts + "/10");
      return delegate.complete(messages, tools, finalOnly, remaining);
    }
  }

  @TestConfiguration(proxyBeanMethods = false)
  static class LiveConfiguration {
    @Bean
    @Primary
    LiveBudget budget(DeepSeekClient client) {
      return new LiveBudget(client);
    }
  }

  public static void main(String[] args) throws Exception {
    String key = new BufferedReader(new InputStreamReader(System.in)).readLine();
    if (key == null || key.isBlank())
      throw new IllegalArgumentException("A runtime key is required on stdin.");
    String model = System.getenv().getOrDefault("WORKOUT_DEEPSEEK_MODEL", "deepseek-v4-flash");
    String image =
        "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
    var cases = new ArrayList<Map<String, Object>>();
    try (var pg =
        new PostgreSQLContainer(DockerImageName.parse(image).asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("p3_live_test")
            .withUsername("p3_live_test")
            .withPassword(UUID.randomUUID().toString())) {
      pg.start();
      var properties = new HashMap<String, Object>();
      properties.put("spring.datasource.url", pg.getJdbcUrl());
      properties.put("spring.datasource.username", pg.getUsername());
      properties.put("spring.datasource.password", pg.getPassword());
      properties.put("workout.assistant.api-key", key);
      properties.put("workout.assistant.model", model);
      properties.put("workout.assistant.worker-enabled", false);
      properties.put("workout.jobs.enabled", false);
      properties.put("workout.registration-enabled", true);
      properties.put("server.port", 0);
      properties.put("logging.level.root", "WARN");
      var environment = new org.springframework.core.env.StandardEnvironment();
      environment
          .getPropertySources()
          .addFirst(
              new org.springframework.core.env.MapPropertySource("live-probe-runtime", properties));
      try (var app =
          new SpringApplicationBuilder(WorkoutApplication.class, LiveConfiguration.class)
              .environment(environment)
              .run()) {
        var identity = app.getBean(IdentityService.class);
        var backups = app.getBean(BackupService.class);
        var service = app.getBean(AssistantService.class);
        var store = app.getBean(AssistantStore.class);
        var worker = app.getBean(AssistantWorker.class);
        String user =
            identity
                .register(
                    "live_synthetic_" + UUID.randomUUID().toString().substring(0, 8),
                    "synthetic-password")
                .id();
        var root =
            AssistantJson.JSON
                .readTree(P3LiveProbe.class.getResourceAsStream("/contracts/training-cases.json"))
                .path("cases")
                .get(0)
                .path("backup");
        var validated =
            app.getBean(BackupValidator.class)
                .validate(new ByteArrayInputStream(AssistantJson.JSON.writeValueAsBytes(root)));
        var backup =
            backups
                .save(
                    user,
                    UploadIdentity.fromDigest(
                        UUID.randomUUID().toString(), "Asia/Shanghai", validated.digest()),
                    validated)
                .backup();
        app.getBean(ProjectionHandler.class)
            .execute(app.getBean(JobExecutionService.class).claim());
        for (int days : List.of(3, 1)) {
          var request =
              new CoachRequest(
                  backup.id(),
                  LocalDate.of(2026, 10, 1),
                  LocalDate.of(2026, 10, 18),
                  days,
                  days == 1 ? 15 : 60,
                  List.of("squat"),
                  true);
          var created = service.create(user, UUID.randomUUID().toString(), request);
          long start = System.nanoTime();
          worker.execute(store.claim());
          String id = (String) created.run().get("id");
          var run = store.get(user, id);
          var record = new LinkedHashMap<String, Object>();
          record.put("days", days);
          record.put("minutes", request.minutes());
          record.put("status", run.status());
          record.put("errorCode", run.errorCode());
          record.put("modelCalls", run.modelCalls());
          record.put("toolCalls", run.toolCalls());
          record.put("totalTokens", run.totalTokens());
          record.put("durationSeconds", (System.nanoTime() - start) / 1_000_000_000.0);
          if ("SUCCEEDED".equals(run.status())) {
            String draftId = AssistantJson.parse(run.resultJson()).path("draftId").asText();
            var draft = service.draft(user, draftId);
            var confirmation = service.confirm(user, draftId, 1);
            if (!confirmation.equals(service.confirm(user, draftId, 1)))
              throw new IllegalStateException("Confirmation replay mismatch.");
            record.put(
                "estimatedMinutes",
                AssistantJson.parse(AssistantJson.JSON.writeValueAsString(draft))
                    .path("payload")
                    .path("estimatedMinutes"));
          }
          cases.add(record);
          System.out.println(
              "LIVE synthetic case days="
                  + days
                  + " status="
                  + run.status()
                  + " requests="
                  + run.modelCalls()
                  + " error="
                  + run.errorCode());
          // Stop on provider errors rather than spending the remaining budget on the same outage.
          if (!"SUCCEEDED".equals(run.status())) break;
        }
        var report =
            Map.of(
                "timestampUtc",
                Instant.now().toString(),
                "requestedModel",
                model,
                "requestAttempts",
                app.getBean(LiveBudget.class).attempts,
                "maxRequests",
                10,
                "data",
                "synthetic-only",
                "cases",
                cases);
        Files.createDirectories(Path.of("../.cache"));
        String reportJson = AssistantJson.JSON.writeValueAsString(report);
        Files.writeString(Path.of("../.cache/p3-live-" + UUID.randomUUID() + ".json"), reportJson);
        Files.writeString(Path.of("../.cache/p3-live.json"), reportJson);
      }
    }
    if (cases.size() != 2 || cases.stream().anyMatch(c -> !"SUCCEEDED".equals(c.get("status"))))
      System.exit(1);
  }
}
