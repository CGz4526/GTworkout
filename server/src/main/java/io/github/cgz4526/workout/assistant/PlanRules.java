package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.shared.ApiFailure;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

@Component
public class PlanRules {
  public record Item(
      String exerciseId, String exerciseName, int defaultSets, int defaultReps, int restSeconds) {}

  public record Template(String id, String name, List<Item> items) {}

  public record Payload(
      int schemaVersion,
      List<Template> templates,
      List<Integer> estimatedMinutes,
      String estimateAssumptions) {}

  public Payload validate(
      JsonNode plan, CoachRequest request, List<ExerciseCatalog.Exercise> catalog, String draftId) {
    AssistantJson.fields(plan, "schemaVersion", "days");
    AssistantJson.integer(plan.get("schemaVersion"), 1, 1);
    var days = plan.path("days");
    if (!days.isArray() || days.size() != request.days()) throw invalid();
    var names = new HashMap<String, String>();
    catalog.forEach(ex -> names.put(ex.id(), ex.name()));
    var allowed = new HashSet<>(request.allowedExerciseIds());
    if (!names.keySet().containsAll(allowed)) throw invalid();
    var templates = new ArrayList<Template>();
    var estimates = new ArrayList<Integer>();
    for (var day : days) {
      AssistantJson.fields(day, "name", "items");
      if (!day.path("name").isString()
          || day.path("name").asText().isBlank()
          || day.path("name").asText().length() > 40) throw invalid();
      var items = day.path("items");
      if (!items.isArray() || items.size() < 1 || items.size() > 8) throw invalid();
      var seen = new HashSet<String>();
      var output = new ArrayList<Item>();
      int seconds = 300;
      for (var item : items) {
        AssistantJson.fields(item, "exerciseId", "sets", "reps", "restSeconds");
        if (!item.path("exerciseId").isString()) throw invalid();
        String id = item.path("exerciseId").asText();
        if (!allowed.contains(id) || !seen.add(id)) throw invalid();
        int sets = AssistantJson.integer(item.get("sets"), 1, 6),
            reps = AssistantJson.integer(item.get("reps"), 1, 30),
            rest = AssistantJson.integer(item.get("restSeconds"), 30, 300);
        seconds += sets * 45 + (sets - 1) * rest + 60;
        output.add(new Item(id, names.get(id), sets, reps, rest));
      }
      int minutes = (seconds + 59) / 60;
      if (minutes > request.minutes()) throw new ApiFailure(422, "PLAN_DURATION_EXCEEDED");
      estimates.add(minutes);
      templates.add(
          new Template(
              "ai-plan-" + draftId + "-" + templates.size(),
              day.path("name").asText(),
              List.copyOf(output)));
    }
    return new Payload(
        1,
        List.copyOf(templates),
        List.copyOf(estimates),
        "热身300秒 + 每组45秒 + 每动作(组数−1)×间歇 + 每动作切换60秒；向上取整分钟，不保证实际用时。");
  }

  private ApiFailure invalid() {
    return new ApiFailure(422, "INVALID_PLAN");
  }
}
