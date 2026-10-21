package io.github.cgz4526.workout.jobs;

public interface JobHandler {
  String type();

  void execute(JobRecord job);

  void terminalFailure(JobRecord job, String code);
}
