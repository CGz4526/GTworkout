package io.github.cgz4526.workout.assistant;

import static org.assertj.core.api.Assertions.*;

import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;

class PlanRulesTest {
  final PlanRules rules = new PlanRules();
  final List<ExerciseCatalog.Exercise> catalog =
      List.of(new ExerciseCatalog.Exercise("squat", "深蹲", "腿"));
  final String day =
      "{\"name\":\"训练\",\"items\":[{\"exerciseId\":\"squat\",\"sets\":3,\"reps\":10,\"restSeconds\":90}]}";

  CoachRequest request(int days, int minutes) {
    return new CoachRequest(
        UUID.randomUUID().toString(),
        LocalDate.of(2026, 10, 1),
        LocalDate.of(2026, 10, 15),
        days,
        minutes,
        List.of("squat"),
        true);
  }

  JsonNode plan(String day) {
    return AssistantJson.parse("{\"schemaVersion\":1,\"days\":[" + day + "]}");
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2, 3, 4, 5, 6, 7})
  void validDayCountsAndStableTemplates(int days) {
    var node =
        AssistantJson.parse(
            "{\"schemaVersion\":1,\"days\":["
                + String.join(",", Collections.nCopies(days, day))
                + "]}");
    var result = rules.validate(node, request(days, 60), catalog, "draft");
    assertThat(result.templates()).hasSize(days);
    assertThat(result.templates().get(0).id()).isEqualTo("ai-plan-draft-0");
    assertThat(result.templates().get(0).items().get(0).exerciseName()).isEqualTo("深蹲");
    assertThat(result.estimatedMinutes()).containsOnly(12);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "\"sets\":0", "\"sets\":7", "\"sets\":1.5", "\"sets\":\"3\"",
        "\"reps\":0", "\"reps\":31", "\"restSeconds\":29", "\"restSeconds\":301"
      })
  void invalidSetBoundsAndTypes(String field) {
    String key = field.split(":")[0];
    String invalid = day.replaceAll(key + ":\\d+", field);
    assertThatThrownBy(() -> rules.validate(plan(invalid), request(1, 60), catalog, "d"))
        .hasMessage("INVALID_PLAN");
  }

  @Test
  void disallowedUnknownAndDuplicateExercisesCannotPass() {
    assertThatThrownBy(
            () ->
                rules.validate(
                    plan(day.replace("squat", "invented")), request(1, 60), catalog, "d"))
        .hasMessage("INVALID_PLAN");
    var doubled =
        day.replace(
            "}]}", "},{\"exerciseId\":\"squat\",\"sets\":1,\"reps\":1,\"restSeconds\":30}]}");
    assertThatThrownBy(() -> rules.validate(plan(doubled), request(1, 60), catalog, "d"))
        .hasMessage("INVALID_PLAN");
    assertThatThrownBy(() -> rules.validate(plan(day), request(1, 60), List.of(), "d"))
        .hasMessage("INVALID_PLAN");
  }

  @Test
  void extraFieldsWrongDaysAndDurationFailClosed() {
    assertThatThrownBy(
            () ->
                rules.validate(
                    plan(day.replace("\"name\":", "\"publish\":true,\"name\":")),
                    request(1, 60),
                    catalog,
                    "d"))
        .hasMessage("INVALID_PLAN");
    assertThatThrownBy(() -> rules.validate(plan(day), request(2, 60), catalog, "d"))
        .hasMessage("INVALID_PLAN");
    assertThatThrownBy(
            () ->
                rules.validate(
                    plan(
                        day.replace("\"sets\":3", "\"sets\":6")
                            .replace("\"restSeconds\":90", "\"restSeconds\":300")),
                    request(1, 15),
                    catalog,
                    "d"))
        .hasMessage("PLAN_DURATION_EXCEEDED");
  }

  @ParameterizedTest
  @ValueSource(strings = {"{\"a\":1,\"a\":2}", "{}{}", "[] rubbish", "{\"x\":NaN}"})
  void malformedDuplicateOrTrailingJsonRejected(String json) {
    assertThatThrownBy(() -> AssistantJson.parse(json)).hasMessage("INVALID_MODEL_OUTPUT");
  }

  @Test
  void missingConsentAndTooWideDatesRejected() {
    var r = request(1, 60);
    assertThatThrownBy(
            () ->
                new CoachRequest(r.backupId(), r.from(), r.to(), 1, 60, List.of("squat"), false)
                    .validate())
        .hasMessage("INVALID_COACH_REQUEST");
    assertThatThrownBy(
            () ->
                new CoachRequest(
                        r.backupId(),
                        r.from(),
                        r.from().plusDays(90),
                        1,
                        60,
                        List.of("squat"),
                        true)
                    .validate())
        .hasMessage("INVALID_COACH_REQUEST");
  }
}
