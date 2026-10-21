package io.github.cgz4526.workout.training;

import io.github.cgz4526.workout.backup.ProjectionBackupAccess;
import io.github.cgz4526.workout.jobs.*;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.List;
import java.util.function.Consumer;
import org.springframework.stereotype.Component;

@Component
public class ProjectionHandler implements JobHandler {
  private final ProjectionBackupAccess backups;
  private final SnapshotProjector projector;
  private final ProjectionMapper projections;
  private final JobExecutionService executions;
  private final MeterRegistry metrics;

  public ProjectionHandler(
      ProjectionBackupAccess backups,
      SnapshotProjector projector,
      ProjectionMapper projections,
      JobExecutionService executions,
      MeterRegistry metrics) {
    this.backups = backups;
    this.projector = projector;
    this.projections = projections;
    this.executions = executions;
    this.metrics = metrics;
  }

  @Override
  public String type() {
    return "BUILD_PROJECTION";
  }

  @Override
  public void execute(JobRecord job) {
    var sample = Timer.start(metrics);
    try {
      build(job);
    } finally {
      sample.stop(metrics.timer("workout.projection.duration"));
    }
  }

  private void build(JobRecord job) {
    executions.assertOwned(job);
    var backup = backups.metadata(job.userId(), job.backupId());
    var projection =
        projector.project(backups.raw(job.userId(), job.backupId()), backup.timezone());
    executions.publish(
        job,
        () -> {
          projections.setTimeout();
          batches(projection.sessions(), rows -> projections.sessions(job.backupId(), rows), job);
          batches(projection.exercises(), rows -> projections.exercises(job.backupId(), rows), job);
          batches(projection.groups(), rows -> projections.groups(job.backupId(), rows), job);
          batches(projection.weights(), rows -> projections.weights(job.backupId(), rows), job);
        },
        () -> backups.state(job.userId(), job.backupId(), "READY"));
  }

  private <T> void batches(List<T> rows, Consumer<List<T>> insert, JobRecord job) {
    for (int offset = 0; offset < rows.size(); offset += 500) {
      executions.assertOwned(job);
      insert.accept(rows.subList(offset, Math.min(offset + 500, rows.size())));
    }
  }

  @Override
  public void terminalFailure(JobRecord job, String code) {
    backups.state(job.userId(), job.backupId(), "FAILED");
  }
}
