package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.backup.BackupService;
import io.github.cgz4526.workout.shared.ApiFailure;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Semaphore;
import org.springframework.stereotype.Service;
import tools.jackson.core.JsonToken;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ExerciseCatalog {
  public record Exercise(String id, String name, String bodyPart) {}

  private final BackupService backups;
  private final Semaphore permits = new Semaphore(2);
  private final JsonMapper json =
      JsonMapper.builder(
              JsonFactory.builder()
                  .streamReadConstraints(
                      StreamReadConstraints.builder()
                          .maxNestingDepth(32)
                          .maxStringLength(8 * 1024 * 1024)
                          .build())
                  .build())
          // This mapper reads one exercise subtree at a time from an already validated backup.
          .disable(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  public ExerciseCatalog(BackupService backups) {
    this.backups = backups;
  }

  public List<Exercise> list(String userId, String backupId) {
    var meta = backups.get(userId, backupId);
    if (!"READY".equals(meta.projectionStatus())) throw new ApiFailure(409, "PROJECTION_NOT_READY");
    if (!permits.tryAcquire()) throw new ApiFailure(429, "CATALOG_BUSY");
    try (var parser = json.createParser(backups.download(userId, backupId))) {
      var result = new ArrayList<Exercise>();
      if (parser.nextToken() != JsonToken.START_OBJECT) throw new IllegalArgumentException();
      while (parser.nextToken() != JsonToken.END_OBJECT) {
        var name = parser.currentName();
        parser.nextToken();
        if ("exercises".equals(name)) {
          while (parser.nextToken() != JsonToken.END_ARRAY) {
            var exercise = json.readTree(parser);
            result.add(
                new Exercise(
                    exercise.path("id").asText(),
                    shortText(exercise.path("name").asText()),
                    shortText(exercise.path("bodyPart").asText())));
            if (result.size() > 5000) throw new ApiFailure(422, "EXERCISE_LIST_TOO_LARGE");
          }
        } else parser.skipChildren();
      }
      return List.copyOf(result);
    } catch (ApiFailure ex) {
      throw ex;
    } catch (Exception ex) {
      throw new ApiFailure(422, "INVALID_BACKUP");
    } finally {
      permits.release();
    }
  }

  private String shortText(String s) {
    return s.substring(0, Math.min(120, s.length()));
  }
}
