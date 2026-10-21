package io.github.cgz4526.workout.training;

import io.github.cgz4526.workout.identity.IdentityService;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/backups/{backupId}")
public class TrainingController {
  private final TrainingService training;
  private final IdentityService identity;

  public TrainingController(TrainingService training, IdentityService identity) {
    this.training = training;
    this.identity = identity;
  }

  @GetMapping("/statistics")
  public TrainingViews.Statistics statistics(
      Authentication auth,
      @PathVariable String backupId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return training.statistics(identity.current(auth).id(), backupId, from, to);
  }

  @GetMapping("/sessions")
  public TrainingViews.SessionPage sessions(
      Authentication auth,
      @PathVariable String backupId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(defaultValue = "20") int limit,
      @RequestParam(defaultValue = "0") int offset) {
    return training.sessions(identity.current(auth).id(), backupId, from, to, limit, offset);
  }

  @GetMapping("/exercises/{sourceId}/progress")
  public List<TrainingViews.Progress> progress(
      Authentication auth,
      @PathVariable String backupId,
      @PathVariable String sourceId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return training.progress(identity.current(auth).id(), backupId, sourceId, from, to);
  }

  @GetMapping("/exercises")
  public List<TrainingViews.Exercise> exercises(
      Authentication auth, @PathVariable String backupId) {
    return training.exercises(identity.current(auth).id(), backupId);
  }
}
