package io.github.cgz4526.workout.assistant;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;

public interface ModelGateway {
  record Reply(JsonNode message, long totalTokens) {}

  Reply complete(
      List<Map<String, Object>> messages,
      List<Map<String, Object>> tools,
      boolean finalOnly,
      Duration remaining);

  boolean configured();

  String model();
}
