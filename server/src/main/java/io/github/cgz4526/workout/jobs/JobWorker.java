package io.github.cgz4526.workout.jobs;

import io.github.cgz4526.workout.shared.ApiFailure;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.RecoverableDataAccessException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "workout.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class JobWorker {
  private static final Logger LOG = LoggerFactory.getLogger(JobWorker.class);
  private final JobExecutionService executions;
  private final List<JobHandler> handlers;
  private final JobMapper jobs;
  private final AtomicLong waiting = new AtomicLong();
  private final AtomicLong running = new AtomicLong();
  private volatile double oldestSeconds;
  private final Semaphore slots = new Semaphore(2);
  private final ExecutorService pool =
      new ThreadPoolExecutor(
          2,
          2,
          0,
          TimeUnit.MILLISECONDS,
          new ArrayBlockingQueue<>(2),
          runnable -> {
            var thread = new Thread(runnable, "workout-job");
            thread.setDaemon(true);
            return thread;
          });
  private final ScheduledExecutorService heartbeats =
      Executors.newScheduledThreadPool(
          2,
          runnable -> {
            var thread = new Thread(runnable, "workout-job-lease");
            thread.setDaemon(true);
            return thread;
          });
  private final AtomicLong lastWarning = new AtomicLong();

  public JobWorker(
      JobExecutionService executions,
      List<JobHandler> handlers,
      JobMapper jobs,
      MeterRegistry metrics) {
    this.executions = executions;
    this.handlers = handlers;
    this.jobs = jobs;
    Gauge.builder("workout.jobs.waiting", waiting, AtomicLong::doubleValue).register(metrics);
    Gauge.builder("workout.jobs.running", running, AtomicLong::doubleValue).register(metrics);
    Gauge.builder("workout.jobs.oldest_wait_seconds", this, worker -> worker.oldestSeconds)
        .register(metrics);
  }

  @Scheduled(fixedDelayString = "${workout.jobs.poll-ms:500}")
  public void poll() {
    try {
      executions.recover(handlers);
      var state = jobs.queueState();
      waiting.set(state.waiting());
      running.set(state.running());
      oldestSeconds = state.oldestSeconds();
      while (slots.tryAcquire()) {
        JobRecord job;
        try {
          job = executions.claim();
        } catch (RuntimeException ex) {
          slots.release();
          throw ex;
        }
        if (job == null) {
          slots.release();
          break;
        }
        try {
          pool.execute(() -> run(job));
        } catch (RejectedExecutionException ex) {
          slots.release();
          break;
        }
      }
    } catch (RuntimeException ex) {
      long now = System.currentTimeMillis();
      long prior = lastWarning.get();
      if (now - prior > 60000 && lastWarning.compareAndSet(prior, now))
        LOG.warn("Job polling unavailable; exceptionType={}", ex.getClass().getSimpleName());
    }
  }

  private void run(JobRecord job) {
    var handler =
        handlers.stream()
            .filter(value -> value.type().equals(job.type()))
            .findFirst()
            .orElseThrow();
    Thread worker = Thread.currentThread();
    Object lifecycle = new Object();
    boolean[] active = {true};
    Runnable interruptActive =
        () -> {
          synchronized (lifecycle) {
            if (active[0]) worker.interrupt();
          }
        };
    var heartbeat =
        heartbeats.scheduleAtFixedRate(
            () -> {
              try {
                if (!executions.renew(job)) interruptActive.run();
              } catch (RuntimeException ex) {
                interruptActive.run();
              }
            },
            5,
            5,
            TimeUnit.SECONDS);
    try {
      handler.execute(job);
    } catch (JobExecutionService.LeaseLost ex) {
      LOG.info("Job lease lost; jobId={}", job.id());
    } catch (RuntimeException ex) {
      try {
        boolean retryable =
            ex instanceof TransientDataAccessException
                || ex instanceof RecoverableDataAccessException
                || ex instanceof DataAccessResourceFailureException;
        executions.fail(
            job,
            handler,
            ex instanceof ApiFailure failure
                ? failure.code()
                : retryable ? "PROJECTION_UNAVAILABLE" : "PROJECTION_INTERNAL_ERROR",
            !retryable);
      } catch (RuntimeException failure) {
        LOG.warn("Job failure deferred to lease recovery; jobId={}", job.id());
      }
    } finally {
      synchronized (lifecycle) {
        active[0] = false;
        heartbeat.cancel(false);
        Thread.interrupted();
      }
      slots.release();
    }
  }

  @PreDestroy
  void stop() {
    pool.shutdownNow();
    heartbeats.shutdownNow();
  }
}
