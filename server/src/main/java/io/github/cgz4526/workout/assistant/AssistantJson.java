package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.shared.ApiFailure;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

final class AssistantJson {
  static final JsonMapper JSON =
      JsonMapper.builder(
              JsonFactory.builder()
                  .streamReadConstraints(
                      StreamReadConstraints.builder()
                          .maxNestingDepth(20)
                          .maxStringLength(65536)
                          .maxTokenCount(20000)
                          .maxNumberLength(20)
                          .build())
                  .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                  .build())
          .build();

  private AssistantJson() {}

  static JsonNode parse(String text) {
    if (text == null || text.getBytes(StandardCharsets.UTF_8).length > 131072)
      throw new ApiFailure(422, "INVALID_MODEL_OUTPUT");
    try (var p = JSON.createParser(text)) {
      var value = JSON.readTree(p);
      if (value == null || p.nextToken() != null) throw new IllegalArgumentException();
      return value;
    } catch (Exception ex) {
      throw new ApiFailure(422, "INVALID_MODEL_OUTPUT");
    }
  }

  static void fields(JsonNode node, String... fields) {
    if (node == null || !node.isObject() || !node.propertyNames().equals(Set.of(fields)))
      throw new ApiFailure(422, "INVALID_PLAN");
  }

  static int integer(JsonNode node, int min, int max) {
    if (node == null
        || !node.isIntegralNumber()
        || !node.canConvertToInt()
        || node.asInt() < min
        || node.asInt() > max) throw new ApiFailure(422, "INVALID_PLAN");
    return node.asInt();
  }
}
