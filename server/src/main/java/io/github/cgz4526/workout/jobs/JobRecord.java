package io.github.cgz4526.workout.jobs;

import java.time.OffsetDateTime;

public record JobRecord(
    String id,
    String userId,
    String backupId,
    String type,
    String status,
    int attempts,
    int manualRetries,
    OffsetDateTime nextRunAt,
    String executionToken,
    OffsetDateTime leaseUntil,
    OffsetDateTime deadlineAt,
    String errorCode) {
  public PublicJob publicJob() {
    return new PublicJob(id, backupId, type, status, attempts, manualRetries, nextRunAt, errorCode);
  }

  public record PublicJob(
      String id,
      String backupId,
      String type,
      String status,
      int attempts,
      int manualRetries,
      OffsetDateTime nextRunAt,
      String errorCode) {}
}
