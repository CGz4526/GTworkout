package io.github.cgz4526.workout.training;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class TrainingViews {
  private TrainingViews() {}

  public record Summary(
      long trainingSessions,
      long trainingDays,
      long strengthSessions,
      long aerobicSessions,
      long restDays,
      long countedSets,
      BigDecimal volume,
      BigDecimal aerobicDistance,
      long aerobicDuration) {}

  public record Coverage(LocalDate dataFrom, LocalDate dataTo) {}

  public record BodyPart(String bodyPart, long trainingDays) {}

  public record Session(
      String sourceId,
      LocalDate localDate,
      String kind,
      String name,
      int duration,
      BigDecimal distance,
      long countedSets,
      BigDecimal volume) {}

  public record Progress(
      LocalDate localDate, long countedSets, BigDecimal volume, BigDecimal maxWeight) {}

  public record Exercise(String sourceExerciseId, String exerciseName, String bodyPart) {}

  public record Statistics(
      String backupId,
      String timezone,
      Coverage coverage,
      Summary summary,
      List<BodyPart> bodyParts,
      List<Projection.Weight> weights) {}

  public record SessionPage(List<Session> items, int offset, boolean hasMore) {}
}
