package io.github.cgz4526.workout.jobs;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class JobExecutionService {
  private final JobMapper jobs;
  private final TransactionTemplate transactions;
  private final int lease;
  private final int deadline;
  private final MeterRegistry metrics;

  public JobExecutionService(
      JobMapper jobs,
      TransactionTemplate transactions,
      MeterRegistry metrics,
      @Value("${workout.jobs.lease-seconds:30}") int lease,
      @Value("${workout.jobs.deadline-seconds:120}") int deadline) {
    this.jobs = jobs;
    this.transactions = transactions;
    this.lease = lease;
    this.deadline = deadline;
    this.metrics = metrics;
    if (lease < 10 || deadline < lease)
      throw new IllegalArgumentException("Invalid job lease configuration");
  }

  public JobRecord claim() {
    var result =
        transactions.execute(status -> jobs.claim(UUID.randomUUID().toString(), lease, deadline));
    if (result != null) metrics.counter("workout.jobs.claimed").increment();
    return result;
  }

  public boolean renew(JobRecord job) {
    return jobs.renew(job, lease) == 1;
  }

  public void assertOwned(JobRecord job) {
    if (jobs.owned(job) != 1) throw new LeaseLost();
  }

  public void publish(JobRecord job, Runnable publisher) {
    publish(job, publisher, () -> {});
  }

  public void publish(JobRecord job, Runnable publisher, Runnable afterCompletion) {
    transactions.executeWithoutResult(
        status -> {
          assertOwned(job);
          publisher.run();
          if (jobs.complete(job) != 1) throw new LeaseLost();
          afterCompletion.run();
        });
    metrics.counter("workout.jobs.succeeded").increment();
  }

  public void fail(JobRecord job, JobHandler handler, String code, boolean permanent) {
    var result =
        transactions.execute(
            status -> {
              var updated = jobs.fail(job, code, permanent);
              if (updated != null && "FAILED".equals(updated.status()))
                handler.terminalFailure(updated, code);
              return updated;
            });
    if (result != null)
      metrics
          .counter(
              "FAILED".equals(result.status())
                  ? "workout.jobs.failed"
                  : "workout.jobs.retry_scheduled")
          .increment();
  }

  public void recover(List<JobHandler> handlers) {
    var recovered =
        transactions.execute(
            status -> {
              var rows = jobs.recoverExpired();
              for (var job : rows)
                if ("FAILED".equals(job.status())) {
                  handlers.stream()
                      .filter(handler -> handler.type().equals(job.type()))
                      .findFirst()
                      .orElseThrow()
                      .terminalFailure(job, "LEASE_EXPIRED");
                }
              return rows;
            });
    if (recovered != null)
      for (var job : recovered) {
        metrics.counter("workout.jobs.lease_recovered").increment();
        metrics
            .counter(
                "FAILED".equals(job.status())
                    ? "workout.jobs.failed"
                    : "workout.jobs.retry_scheduled")
            .increment();
      }
  }

  public static class LeaseLost extends RuntimeException {}
}
