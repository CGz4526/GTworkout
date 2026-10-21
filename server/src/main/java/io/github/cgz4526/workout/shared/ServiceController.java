package io.github.cgz4526.workout.shared;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ServiceController {
  private final io.github.cgz4526.workout.assistant.ModelGateway model;
  private final boolean trainingWrites;

  public ServiceController(io.github.cgz4526.workout.assistant.ModelGateway model,
      @org.springframework.beans.factory.annotation.Value("${workout.training-write-enabled:false}") boolean trainingWrites) {
    this.model = model;
    this.trainingWrites = trainingWrites;
  }

  @GetMapping({"/api/status", "/api/v1/system/status"})
  public Map<String, Object> status() {
    return Map.of(
        "stage",
        "P3",
        "service",
        "workout-server",
        "capabilities",
        Map.of(
            "identity", true, "backup", true, "training", true, "trainingWrites", trainingWrites, "assistant", model.configured()));
  }
}
