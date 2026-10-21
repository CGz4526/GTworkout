package io.github.cgz4526.workout.training;

import io.github.cgz4526.workout.backup.BackupService;
import io.github.cgz4526.workout.shared.ApiFailure;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class TrainingService {
  private final BackupService backups;
  private final TrainingMapper training;

  public TrainingService(BackupService backups, TrainingMapper training) {
    this.backups = backups;
    this.training = training;
  }

  private void ready(String userId, String backupId, LocalDate from, LocalDate to) {
    var backup = backups.get(userId, backupId);
    if (!"READY".equals(backup.projectionStatus()))
      throw new ApiFailure(409, "PROJECTION_NOT_READY");
    if ((from == null) != (to == null)
        || (from != null
            && (from.getYear() < 1
                || from.getYear() > 9999
                || to.getYear() < 1
                || to.getYear() > 9999
                || from.isAfter(to)
                || ChronoUnit.DAYS.between(from, to) > 3660)))
      throw new ApiFailure(422, "INVALID_DATE_RANGE");
  }

  public TrainingViews.Statistics statistics(
      String userId, String backupId, LocalDate from, LocalDate to) {
    ready(userId, backupId, from, to);
    var coverage = training.coverage(backupId);
    return new TrainingViews.Statistics(
        backupId,
        backups.get(userId, backupId).timezone(),
        coverage == null ? new TrainingViews.Coverage(null, null) : coverage,
        training.summary(backupId, from, to),
        training.bodyParts(backupId, from, to),
        training.weights(backupId, from, to));
  }

  public TrainingViews.SessionPage sessions(
      String userId, String backupId, LocalDate from, LocalDate to, int limit, int offset) {
    ready(userId, backupId, from, to);
    if (limit < 1 || limit > 50 || offset < 0 || offset > 20000)
      throw new ApiFailure(422, "INVALID_PAGE");
    var rows = training.sessions(backupId, from, to, limit + 1, offset);
    return new TrainingViews.SessionPage(
        rows.subList(0, Math.min(limit, rows.size())), offset, rows.size() > limit);
  }

  public List<TrainingViews.Progress> progress(
      String userId, String backupId, String sourceId, LocalDate from, LocalDate to) {
    ready(userId, backupId, from, to);
    if (sourceId.isBlank() || sourceId.length() > 128)
      throw new ApiFailure(422, "INVALID_EXERCISE_ID");
    var rows = training.progress(backupId, sourceId, from, to);
    if (rows.size() > 500) throw new ApiFailure(422, "DATE_RANGE_TOO_WIDE");
    return rows;
  }

  public List<TrainingViews.Exercise> exercises(String userId, String backupId) {
    ready(userId, backupId, null, null);
    var result = training.exercises(backupId);
    if (result.size() > 5000) throw new ApiFailure(422, "EXERCISE_LIST_TOO_LARGE");
    return result;
  }
}
