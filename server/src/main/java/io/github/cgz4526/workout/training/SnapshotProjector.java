package io.github.cgz4526.workout.training;

import io.github.cgz4526.workout.jobs.JobExecutionService;
import io.github.cgz4526.workout.shared.ApiFailure;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class SnapshotProjector {
  private final JsonMapper json =
      JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

  private record Fallback(Instant instant, String sourceId, BigDecimal weight) {}

  public Projection project(byte[] bytes, String timezone) {
    try {
      var root = json.readTree(bytes);
      var zone = ZoneId.of(timezone);
      Map<String, String> parts = new HashMap<>();
      for (var exercise : root.path("exercises"))
        parts.put(exercise.path("id").asString(), exercise.path("bodyPart").asString("未知"));
      var sessions = new ArrayList<Projection.Session>();
      var exercises = new ArrayList<Projection.Exercise>();
      var groups = new ArrayList<Projection.Group>();
      var weights = new TreeMap<LocalDate, Projection.Weight>();
      var fallback = new HashMap<LocalDate, Fallback>();
      for (var session : root.path("sessions")) {
        checkInterrupted();
        String id = UUID.randomUUID().toString();
        String sourceId = session.path("id").asString();
        String iso = session.path("date").asString();
        var instant = Instant.parse(iso);
        var day = instant.atZone(zone).toLocalDate();
        checkDate(day);
        String kind =
            session.path("aerobic").asBoolean(false)
                ? "AEROBIC"
                : session.path("exercises").isEmpty() && session.path("startTime").asLong(0) == 0
                    ? "REST"
                    : "STRENGTH";
        sessions.add(
            new Projection.Session(
                id,
                sourceId,
                iso,
                instant.atOffset(ZoneOffset.UTC),
                day,
                kind,
                session.path("finished").asBoolean(false),
                session.path("templateName").asString(null),
                session.path("duration").asInt(0),
                decimal(session, "distance", BigDecimal.ZERO)));
        BigDecimal weight = decimal(session, "weight", null);
        if (weight != null && weight.signum() > 0) {
          var prior = fallback.get(day);
          if (prior == null
              || instant.isAfter(prior.instant())
              || (instant.equals(prior.instant()) && sourceId.compareTo(prior.sourceId()) > 0))
            fallback.put(day, new Fallback(instant, sourceId, weight));
        }
        int exerciseOrdinal = 0;
        for (var exercise : session.path("exercises")) {
          String exerciseId = UUID.randomUUID().toString();
          String sourceExercise = exercise.path("exerciseId").asString();
          exercises.add(
              new Projection.Exercise(
                  exerciseId,
                  id,
                  exerciseOrdinal++,
                  sourceExercise,
                  exercise.path("exerciseName").asString(null),
                  parts.getOrDefault(sourceExercise, "未知")));
          int ordinal = 0;
          for (var group : exercise.path("sets")) {
            checkInterrupted();
            groups.add(
                new Projection.Group(
                    exerciseId,
                    ordinal++,
                    decimal(group, "weight", null),
                    group.has("reps") ? group.get("reps").asInt() : null,
                    group.path("completed").asBoolean(false),
                    group.path("warmup").asBoolean(false),
                    decimal(group, "rpe", null)));
          }
        }
      }
      fallback.forEach(
          (date, value) ->
              weights.put(date, new Projection.Weight(date, value.weight(), "SESSION")));
      for (var weight : root.path("weights")) {
        var date = LocalDate.parse(weight.path("date").asString());
        checkDate(date);
        weights.put(date, new Projection.Weight(date, decimal(weight, "weight", null), "EXPLICIT"));
      }
      return new Projection(sessions, exercises, groups, new ArrayList<>(weights.values()));
    } catch (JobExecutionService.LeaseLost ex) {
      throw ex;
    } catch (ApiFailure ex) {
      throw ex;
    } catch (RuntimeException ex) {
      throw new ApiFailure(422, "PROJECTION_INVALID");
    }
  }

  private static BigDecimal decimal(JsonNode node, String field, BigDecimal fallback) {
    if (!node.has(field)) return fallback;
    BigDecimal value = node.get(field).decimalValue();
    if (value.scale() > 16383 || value.precision() - value.scale() > 131072)
      throw new ApiFailure(422, "PROJECTION_NUMERIC_RANGE");
    return value;
  }

  private static void checkDate(LocalDate date) {
    if (date.getYear() < 1 || date.getYear() > 9999)
      throw new ApiFailure(422, "PROJECTION_DATE_RANGE");
  }

  private static void checkInterrupted() {
    if (Thread.currentThread().isInterrupted()) throw new JobExecutionService.LeaseLost();
  }
}
