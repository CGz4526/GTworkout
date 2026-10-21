package io.github.cgz4526.workout.jobs;

import io.github.cgz4526.workout.shared.ApiFailure;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JobService {
  private final JobMapper jobs;

  public JobService(JobMapper jobs) {
    this.jobs = jobs;
  }

  @Transactional
  public String enqueue(String userId, String backupId) {
    String id = UUID.randomUUID().toString();
    jobs.insert(id, userId, backupId);
    return id;
  }

  public JobRecord.PublicJob get(String userId, String id) {
    try {
      if (!UUID.fromString(id).toString().equalsIgnoreCase(id))
        throw new IllegalArgumentException();
    } catch (RuntimeException ex) {
      throw new ApiFailure(404, "JOB_NOT_FOUND");
    }
    var job = jobs.get(userId, id);
    if (job == null) throw new ApiFailure(404, "JOB_NOT_FOUND");
    return job.publicJob();
  }

  @Transactional
  public void retry(String userId, String backupId) {
    var job = jobs.forBackup(userId, backupId);
    if (job == null || jobs.retry(job.id()) != 1) throw new ApiFailure(409, "JOB_NOT_RETRYABLE");
  }
}
