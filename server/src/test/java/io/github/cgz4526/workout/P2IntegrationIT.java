package io.github.cgz4526.workout;

import static org.assertj.core.api.Assertions.*;

import io.github.cgz4526.workout.backup.*;
import io.github.cgz4526.workout.identity.*;
import io.github.cgz4526.workout.jobs.*;
import io.github.cgz4526.workout.shared.ApiFailure;
import io.github.cgz4526.workout.training.*;
import java.io.ByteArrayInputStream;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "workout.registration-enabled=true",
      "workout.max-users=100",
      "workout.jobs.enabled=false",
      "workout.assistant.api-key=",
      "workout.assistant.model="
    })
class P2IntegrationIT {
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
              DockerImageName.parse(
                      "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
                  .asCompatibleSubstituteFor("postgres"))
          .withDatabaseName("workout_p2_test")
          .withUsername("workout_test")
          .withPassword(UUID.randomUUID().toString());

  static {
    POSTGRES.start();
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
  }

  @Autowired IdentityService identity;
  @Autowired BackupService backups;
  @Autowired BackupValidator validator;
  @Autowired BackupMapper legacyBackups;
  @Autowired JobService jobs;
  @Autowired JobMapper jobMapper;
  @Autowired JobExecutionService executions;
  @Autowired ProjectionHandler handler;
  @Autowired TrainingService training;
  @Autowired ProjectionMapper projections;
  @Autowired SnapshotProjector projector;
  @Autowired TransactionTemplate transactions;
  @Autowired JdbcTemplate jdbc;
  final JsonMapper json = JsonMapper.builder().build();

  String owner() {
    return identity
        .register(
            "p2_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20),
            "synthetic-password")
        .id();
  }

  BackupMetadata upload(String owner, byte[] raw, String zone) throws Exception {
    var data = validator.validate(new ByteArrayInputStream(raw));
    return backups
        .save(
            owner,
            UploadIdentity.fromDigest(UUID.randomUUID().toString(), zone, data.digest()),
            data)
        .backup();
  }

  void expire(JobRecord job) {
    jdbc.update(
        "UPDATE background_job SET lease_until=clock_timestamp()-interval '1 second' WHERE"
            + " id=CAST(? AS uuid)",
        job.id());
  }

  void due(String id) {
    jdbc.update(
        "UPDATE background_job SET next_run_at=clock_timestamp() WHERE id=CAST(? AS uuid)", id);
  }

  long rows(String backupId) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM snapshot_session WHERE backup_id=CAST(? AS uuid)",
        Long.class,
        backupId);
  }

  @Test
  void projectionContractsAndDurableJobFailureScenarios() throws Exception {
    var fixture = json.readTree(getClass().getResourceAsStream("/contracts/training-cases.json"));
    var first = fixture.path("cases").get(0);
    byte[] raw = json.writeValueAsBytes(first.path("backup"));
    String user = owner();
    for (var item : fixture.path("cases")) {
      var backup =
          upload(
              user, json.writeValueAsBytes(item.path("backup")), item.path("timezone").asString());
      assertThatThrownBy(() -> training.statistics(user, backup.id(), null, null))
          .isInstanceOf(ApiFailure.class)
          .hasMessage("PROJECTION_NOT_READY");
      var job = executions.claim();
      assertThat(job.backupId()).isEqualTo(backup.id());
      handler.execute(job);
      assertThat(jobs.get(user, job.id()).status()).isEqualTo("SUCCEEDED");
      var statistics = training.statistics(user, backup.id(), null, null);
      var actual = json.valueToTree(statistics.summary());
      for (var field : item.path("expected").path("summary").properties())
        assertThat(actual.path(field.getKey()).asDouble())
            .as(item.path("name").asString() + ":" + field.getKey())
            .isEqualTo(field.getValue().asDouble());
      Map<String, Long> parts = new HashMap<>();
      statistics.bodyParts().forEach(value -> parts.put(value.bodyPart(), value.trainingDays()));
      for (var field : item.path("expected").path("bodyParts").properties())
        assertThat(parts.get(field.getKey())).isEqualTo(field.getValue().asLong());
      assertThat(statistics.weights()).hasSize(item.path("expected").path("weights").size());
      assertThat(backups.download(user, backup.id()))
          .isEqualTo(json.writeValueAsBytes(item.path("backup")));
      assertThatThrownBy(() -> training.statistics(owner(), backup.id(), null, null))
          .isInstanceOf(ApiFailure.class)
          .hasMessage("BACKUP_NOT_FOUND");
      assertThatThrownBy(() -> jobs.get(owner(), job.id()))
          .isInstanceOf(ApiFailure.class)
          .hasMessage("JOB_NOT_FOUND");
    }

    // Two claimants cannot obtain the same durable task, a third gets no task.
    var a = upload(user, raw, "Asia/Shanghai");
    var b = upload(user, raw, "Asia/Shanghai");
    ExecutorService pool = Executors.newFixedThreadPool(3);
    var claimed = new ArrayList<JobRecord>();
    try {
      for (var future :
          pool.invokeAll(
              List.<Callable<JobRecord>>of(
                  executions::claim, executions::claim, executions::claim))) {
        var result = future.get();
        if (result != null) claimed.add(result);
      }
    } finally {
      pool.shutdownNow();
    }
    assertThat(claimed).hasSize(2);
    assertThat(claimed.stream().map(JobRecord::backupId)).containsExactlyInAnyOrder(a.id(), b.id());
    claimed.forEach(handler::execute);

    // A row held by another transaction must be skipped without waiting for its lock.
    var locked = upload(user, raw, "Asia/Shanghai");
    var available = upload(user, raw, "Asia/Shanghai");
    var lockedLatch = new CountDownLatch(1);
    var unlock = new CountDownLatch(1);
    ExecutorService lockPool = Executors.newFixedThreadPool(2);
    try {
      var holder =
          lockPool.submit(
              () ->
                  transactions.executeWithoutResult(
                      status -> {
                        jdbc.queryForObject(
                            "SELECT id::text FROM background_job WHERE backup_id=CAST(? AS uuid)"
                                + " FOR UPDATE",
                            String.class,
                            locked.id());
                        lockedLatch.countDown();
                        try {
                          if (!unlock.await(10, TimeUnit.SECONDS))
                            throw new IllegalStateException("Test lock timeout");
                        } catch (InterruptedException ex) {
                          Thread.currentThread().interrupt();
                          throw new IllegalStateException(ex);
                        }
                      }));
      assertThat(lockedLatch.await(5, TimeUnit.SECONDS)).isTrue();
      var skipped = lockPool.submit(executions::claim).get(2, TimeUnit.SECONDS);
      assertThat(skipped.backupId()).isEqualTo(available.id());
      unlock.countDown();
      holder.get(5, TimeUnit.SECONDS);
      handler.execute(skipped);
      var formerlyLocked = executions.claim();
      assertThat(formerlyLocked.backupId()).isEqualTo(locked.id());
      jdbc.update(
          "UPDATE background_job SET deadline_at=clock_timestamp()+interval '5 seconds' WHERE"
              + " id=CAST(? AS uuid)",
          formerlyLocked.id());
      assertThat(executions.renew(formerlyLocked)).isTrue();
      var renewed = jobMapper.get(user, formerlyLocked.id());
      assertThat(renewed.leaseUntil()).isBeforeOrEqualTo(renewed.deadlineAt());
      handler.execute(renewed);
    } finally {
      unlock.countDown();
      lockPool.shutdownNow();
    }

    // A failure after inserting a partial projection rolls back rows and success together.
    var failed = upload(user, raw, "Asia/Shanghai");
    var attempt = executions.claim();
    var projection = projector.project(raw, "Asia/Shanghai");
    assertThatThrownBy(
            () ->
                executions.publish(
                    attempt,
                    () -> {
                      projections.sessions(failed.id(), projection.sessions().subList(0, 1));
                      throw new IllegalStateException("SYNTHETIC_FAILURE");
                    }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(rows(failed.id())).isZero();
    assertThat(backups.get(user, failed.id()).projectionStatus()).isEqualTo("PROCESSING");
    executions.fail(attempt, handler, "PROJECTION_INVALID", true);
    assertThat(backups.get(user, failed.id()).projectionStatus()).isEqualTo("FAILED");
    assertThat(backups.download(user, failed.id())).isEqualTo(raw);
    backups.requestProjection(user, failed.id());
    handler.execute(executions.claim());
    assertThat(backups.get(user, failed.id()).projectionStatus()).isEqualTo("READY");

    // Expire while publishing, using an independent committed connection: the fence must roll back
    // inserts.
    var fenced = upload(user, raw, "Asia/Shanghai");
    var old = executions.claim();
    var independent = new TransactionTemplate(transactions.getTransactionManager());
    independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    assertThatThrownBy(
            () ->
                executions.publish(
                    old,
                    () -> {
                      projections.sessions(fenced.id(), projection.sessions().subList(0, 1));
                      independent.executeWithoutResult(status -> expire(old));
                    }))
        .isInstanceOf(JobExecutionService.LeaseLost.class);
    assertThat(rows(fenced.id())).isZero();
    executions.recover(List.of(handler));
    due(old.id());
    var replacement = executions.claim();
    assertThat(replacement.executionToken()).isNotEqualTo(old.executionToken());
    assertThat(executions.renew(old)).isFalse();
    assertThatThrownBy(() -> handler.execute(old))
        .isInstanceOf(JobExecutionService.LeaseLost.class);
    handler.execute(replacement);
    assertThat(rows(fenced.id())).isEqualTo(first.path("backup").path("sessions").size());

    // Expired processes stop retrying after the third attempt; recovery publishes FAILED
    // atomically.
    var exhausted = upload(user, raw, "Asia/Shanghai");
    for (int i = 1; i <= 3; i++) {
      var job = executions.claim();
      assertThat(job.attempts()).isEqualTo(i);
      expire(job);
      executions.recover(List.of(handler));
      assertThat(jobs.get(user, job.id()).status()).isEqualTo(i == 3 ? "FAILED" : "RETRY_WAIT");
      if (i < 3) due(job.id());
    }
    assertThat(backups.get(user, exhausted.id()).projectionStatus()).isEqualTo("FAILED");
    assertThat(executions.claim()).isNull();
    assertThat(rows(exhausted.id())).isZero();

    for (int i = 0; i < 3; i++) {
      backups.requestProjection(user, exhausted.id());
      var manual = executions.claim();
      executions.fail(manual, handler, "PROJECTION_INVALID", true);
    }
    assertThatThrownBy(() -> backups.requestProjection(user, exhausted.id()))
        .isInstanceOf(ApiFailure.class)
        .hasMessage("JOB_NOT_RETRYABLE");

    // Preserve P1-style backups until an explicit request creates their first projection task.
    var legacyData = validator.validate(new ByteArrayInputStream(raw));
    String legacyId = UUID.randomUUID().toString();
    legacyBackups.insert(
        legacyId,
        user,
        UploadIdentity.fromDigest(
            UUID.randomUUID().toString(), "Asia/Shanghai", legacyData.digest()),
        legacyData);
    assertThat(backups.get(user, legacyId).projectionStatus()).isEqualTo("NOT_REQUESTED");
    assertThat(executions.claim()).isNull();
    backups.requestProjection(user, legacyId);
    handler.execute(executions.claim());
    assertThat(backups.get(user, legacyId).projectionStatus()).isEqualTo("READY");
    assertThat(backups.download(user, legacyId)).isEqualTo(raw);

    var empty =
        upload(
            user,
            "{\"version\":3,\"exercises\":[],\"templates\":[],\"sessions\":[],\"weights\":[]}"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8),
            "UTC");
    handler.execute(executions.claim());
    assertThat(training.statistics(user, empty.id(), null, null).summary().trainingSessions())
        .isZero();
    assertThat(training.statistics(user, empty.id(), null, null).coverage().dataFrom()).isNull();
  }
}
