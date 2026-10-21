package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.shared.ApiFailure;
import io.github.cgz4526.workout.training.TrainingService;
import jakarta.annotation.PreDestroy;
import java.util.UUID;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class AssistantWorker {
  private final AssistantStore store;
  private final AssistantService service;
  private final CoachEngine engine;
  private final ExerciseCatalog catalog;
  private final TrainingService training;
  private final ModelGateway model;
  private final boolean enabled;
  private final Semaphore permit = new Semaphore(1);
  private final ExecutorService executor =
      Executors.newSingleThreadExecutor(
          r -> {
            var t = new Thread(r, "coach-agent");
            t.setDaemon(true);
            return t;
          });

  public AssistantWorker(
      AssistantStore store,
      AssistantService service,
      CoachEngine engine,
      ExerciseCatalog catalog,
      TrainingService training,
      ModelGateway model,
      @Value("${workout.assistant.worker-enabled:true}") boolean enabled) {
    this.store = store;
    this.service = service;
    this.engine = engine;
    this.catalog = catalog;
    this.training = training;
    this.model = model;
    this.enabled = enabled;
  }

  @Scheduled(fixedDelay = 1000)
  public void poll() {
    if (!enabled) return;
    store.recover();
    if (!model.configured() || !permit.tryAcquire()) return;
    try {
      executor.execute(
          () -> {
            try {
              var run = store.claim();
              if (run != null) execute(run);
            } finally {
              permit.release();
            }
          });
    } catch (RejectedExecutionException ex) {
      permit.release();
    }
  }

  public void execute(AssistantStore.Run run) {
    try {
      if (!model.model().equals(run.model()))
        throw new ApiFailure(503, "MODEL_CONFIGURATION_CHANGED");
      var request = AssistantJson.JSON.readValue(run.requestJson(), CoachRequest.class);
      var tools =
          new CoachTools(
              run.userId(), request, training, catalog.list(run.userId(), run.backupId()));
      String draftId = UUID.randomUUID().toString();
      var result =
          engine.generate(
              request,
              tools,
              draftId,
              run.deadlineAt(),
              usage -> {
                if (store.usage(run, usage) != 1)
                  throw new ApiFailure(409, "AGENT_EXECUTION_EXPIRED");
              });
      service.publish(run, draftId, result);
    } catch (ApiFailure ex) {
      store.failed(run, ex.code());
    } catch (Exception ex) {
      store.failed(run, "AGENT_EXECUTION_FAILED");
    }
  }

  @PreDestroy
  public void close() {
    executor.shutdownNow();
  }
}
