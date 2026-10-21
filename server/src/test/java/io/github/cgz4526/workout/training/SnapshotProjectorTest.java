package io.github.cgz4526.workout.training;

import static org.assertj.core.api.Assertions.*;

import io.github.cgz4526.workout.backup.BackupValidator;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class SnapshotProjectorTest {
  final JsonMapper json = JsonMapper.builder().build();
  final SnapshotProjector projector = new SnapshotProjector();

  @Test
  void sharedFixturesMatchDatesGroupsKindsAndWeightPrecedence() throws Exception {
    var fixture = json.readTree(getClass().getResourceAsStream("/contracts/training-cases.json"));
    for (var item : fixture.path("cases")) {
      byte[] raw = json.writeValueAsBytes(item.path("backup"));
      new BackupValidator().validate(new ByteArrayInputStream(raw));
      var projection = projector.project(raw, item.path("timezone").asString());
      var expected = item.path("expected");
      assertThat(projection.sessions().stream().map(row -> row.localDate().toString()).toList())
          .containsExactlyElementsOf(
              expected.path("localDates").valueStream().map(node -> node.asString()).toList());
      Map<String, Projection.Session> sessions = new HashMap<>();
      projection.sessions().forEach(row -> sessions.put(row.id(), row));
      Map<String, Projection.Exercise> exercises = new HashMap<>();
      projection.exercises().forEach(row -> exercises.put(row.id(), row));
      var counted =
          projection.groups().stream()
              .filter(
                  row ->
                      row.completed()
                          && !row.warmup()
                          && sessions.get(exercises.get(row.exerciseId()).sessionId()).finished())
              .toList();
      BigDecimal volume =
          counted.stream()
              .map(
                  row ->
                      row.weight() == null || row.reps() == null
                          ? BigDecimal.ZERO
                          : row.weight().multiply(BigDecimal.valueOf(row.reps())))
              .reduce(BigDecimal.ZERO, BigDecimal::add);
      assertThat(counted.size()).isEqualTo(expected.path("summary").path("countedSets").asInt());
      assertThat(volume)
          .isEqualByComparingTo(expected.path("summary").path("volume").decimalValue());
      assertThat(projection.weights()).hasSize(expected.path("weights").size());
      for (int i = 0; i < projection.weights().size(); i++) {
        var actual = projection.weights().get(i);
        var weight = expected.path("weights").get(i);
        assertThat(actual.localDate().toString()).isEqualTo(weight.path("localDate").asString());
        assertThat(actual.weight()).isEqualByComparingTo(weight.path("weight").decimalValue());
        assertThat(actual.source()).isEqualTo(weight.path("source").asString());
      }
    }
  }

  @Test
  void usesSnapshotZoneRatherThanDefaultJvmZone() {
    TimeZone prior = TimeZone.getDefault();
    try {
      TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Honolulu"));
      String raw =
          "{\"exercises\":[],\"sessions\":[{\"id\":\"one\",\"date\":\"2026-10-15T16:30:00Z\",\"startTime\":1}]}";
      var result =
          projector.project(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8), "Asia/Shanghai");
      assertThat(result.sessions().get(0).localDate().toString()).isEqualTo("2026-10-16");
      assertThat(result.sessions().get(0).kind()).isEqualTo("STRENGTH");
    } finally {
      TimeZone.setDefault(prior);
    }
  }
}
