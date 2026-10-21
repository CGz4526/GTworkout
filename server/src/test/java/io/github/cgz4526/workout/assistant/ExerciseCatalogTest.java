package io.github.cgz4526.workout.assistant;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.github.cgz4526.workout.backup.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class ExerciseCatalogTest {
  @Test
  void streamingParserSkipsNonExerciseContent() {
    var backup = mock(BackupService.class);
    var metadata = mock(BackupMetadata.class);
    when(metadata.projectionStatus()).thenReturn("READY");
    when(backup.get("u", "b")).thenReturn(metadata);
    when(backup.download("u", "b"))
        .thenReturn(
            "{\"version\":3,\"exercises\":[{\"id\":\"x\",\"name\":\"X\",\"bodyPart\":\"腿\"},{\"id\":\"y\",\"name\":\"Y\",\"bodyPart\":\"背\"}],\"sessions\":[{\"photos\":[\"not-to-send\"]}]}"
                .getBytes(StandardCharsets.UTF_8));
    assertThat(new ExerciseCatalog(backup).list("u", "b"))
        .extracting(ExerciseCatalog.Exercise::id)
        .containsExactly("x", "y");
  }
}
