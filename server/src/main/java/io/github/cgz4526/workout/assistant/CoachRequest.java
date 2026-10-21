package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.shared.ApiFailure;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

public record CoachRequest(
    String backupId,
    LocalDate from,
    LocalDate to,
    int days,
    int minutes,
    List<String> allowedExerciseIds,
    boolean consent) {
  public void validate() {
    try {
      UUID.fromString(backupId);
    } catch (Exception ex) {
      throw invalid();
    }
    if (from == null
        || to == null
        || from.isAfter(to)
        || from.getYear() < 2
        || to.getYear() > 9999
        || ChronoUnit.DAYS.between(from, to) > 89
        || days < 1
        || days > 7
        || minutes < 15
        || minutes > 120
        || !consent
        || allowedExerciseIds == null
        || allowedExerciseIds.isEmpty()
        || allowedExerciseIds.size() > 30
        || new HashSet<>(allowedExerciseIds).size() != allowedExerciseIds.size()
        || allowedExerciseIds.stream()
            .anyMatch(id -> id == null || id.isBlank() || id.length() > 128)) throw invalid();
  }

  public LocalDate previousFrom() {
    return from.minusDays(ChronoUnit.DAYS.between(from, to) + 1);
  }

  public LocalDate previousTo() {
    return from.minusDays(1);
  }

  private ApiFailure invalid() {
    return new ApiFailure(422, "INVALID_COACH_REQUEST");
  }
}
