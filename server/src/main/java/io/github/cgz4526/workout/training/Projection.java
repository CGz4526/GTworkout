package io.github.cgz4526.workout.training;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

public record Projection(
    List<Session> sessions, List<Exercise> exercises, List<Group> groups, List<Weight> weights) {
  public record Session(
      String id,
      String sourceId,
      String sourceIso,
      OffsetDateTime startedAt,
      LocalDate localDate,
      String kind,
      boolean finished,
      String name,
      int duration,
      BigDecimal distance) {}

  public record Exercise(
      String id,
      String sessionId,
      int ordinal,
      String sourceExerciseId,
      String exerciseName,
      String bodyPart) {}

  public record Group(
      String exerciseId,
      int ordinal,
      BigDecimal weight,
      Integer reps,
      boolean completed,
      boolean warmup,
      BigDecimal rpe) {}

  public record Weight(LocalDate localDate, BigDecimal weight, String source) {}
}
