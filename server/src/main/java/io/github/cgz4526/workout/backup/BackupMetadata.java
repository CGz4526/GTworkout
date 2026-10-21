package io.github.cgz4526.workout.backup;

import java.time.OffsetDateTime;

public record BackupMetadata(String id, OffsetDateTime createdAt, int sizeBytes, String sha256,
        int formatVersion, String timezone, int exerciseCount, int templateCount,
        int sessionCount, int weightCount, String projectionStatus, String jobId) { }
