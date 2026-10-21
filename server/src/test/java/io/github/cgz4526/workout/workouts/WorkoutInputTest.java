package io.github.cgz4526.workout.workouts;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class WorkoutInputTest {
    private static final UUID SESSION = UUID.fromString("69df59f4-54de-4dd9-abfb-24b2fda4f683");
    private static final UUID DEVICE = UUID.fromString("bf125b17-8a8d-4cd5-860f-e470d451227d");
    private static final String SET = """
        {"id":"dfd17659-b7cd-4f87-bfb8-0b43fbbeab41","weightKg":40,"reps":10,"completed":true,"warmup":false,"rpe":7.5}
        """.strip();
    private static final String BODY = """
        {"mutationId":"cdcd5bbd-e951-4385-991d-3d48adbce201","expectedVersion":0,
         "deviceId":"bf125b17-8a8d-4cd5-860f-e470d451227d","session":{
         "id":"69df59f4-54de-4dd9-abfb-24b2fda4f683","type":"STRENGTH","status":"ACTIVE",
         "occurredAt":"2026-10-15T17:00:00Z","localDate":"2026-10-16","utcOffsetMinutes":480,
         "durationSeconds":0,"exercises":[{"id":"02e14148-d4c5-4bdc-a0e5-b990854ff986",
         "exerciseId":"ff4ab303-5b58-46b0-9062-8e7d0a25b081","exerciseName":"深蹲","restSeconds":150,"sets":[%s]}]}}
        """.formatted(SET);
    private WorkoutInput.Validated read(String body, UUID path) throws Exception {
        return WorkoutInput.read(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)), path);
    }
    @Test void acceptsEastAsianDateAndStableRetryDigest() throws Exception {
        var first = read(BODY, null);
        assertThat(first.sessionId()).isEqualTo(SESSION);
        assertThat(first.requestSha256()).isEqualTo(read(BODY, null).requestSha256()).hasSize(64);
        assertThat(read(BODY.replace("40", "41"), null).requestSha256()).isNotEqualTo(first.requestSha256());
    }
    @Test void rejectsUnknownAndDuplicateJsonFields() {
        assertThatThrownBy(() -> read(BODY.replace("\"durationSeconds\":0", "\"photos\":[],\"durationSeconds\":0"), null)).hasMessage("UNKNOWN_FIELD");
        assertThatThrownBy(() -> read(BODY.replace("\"durationSeconds\":0", "\"durationSeconds\":0,\"durationSeconds\":1"), null)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void rejectsWrongBusinessDayAndDuplicateSetIdentity() {
        assertThatThrownBy(() -> read(BODY.replace("\"localDate\":\"2026-10-16\"", "\"localDate\":\"2026-10-15\""), null)).hasMessage("LOCAL_DATE_MISMATCH");
        assertThatThrownBy(() -> read(BODY.replace(SET, SET + "," + SET), null)).hasMessage("DUPLICATE_SET_ID");
    }
    @Test void enforcesNumericRulesWithoutSilentlyClamping() {
        for (String bad : new String[]{"5.5", "7.2", "10.5"}) {
            assertThatThrownBy(() -> read(BODY.replace("7.5", bad), null)).isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(() -> read(BODY.replace("\"weightKg\":40", "\"weightKg\":0.0001"), null)).hasMessage("INVALID_weightKg");
        assertThatThrownBy(() -> read(BODY.replace("\"reps\":10", "\"reps\":1.5"), null)).hasMessage("INVALID_reps");
    }
    @Test void acceptsBodyweightAndUncompletedSets() throws Exception {
        assertThat(read(BODY.replace("\"weightKg\":40,", "").replace("\"completed\":true", "\"completed\":false"), null).status()).isEqualTo(WorkoutInput.Status.ACTIVE);
    }
    @Test void checksPathVersionAndTerminalState() throws Exception {
        assertThatThrownBy(() -> read(BODY, SESSION)).hasMessage("INVALID_EXPECTED_VERSION");
        String update = BODY.replace("\"expectedVersion\":0", "\"expectedVersion\":1");
        var input = read(update, SESSION);
        assertThatThrownBy(() -> read(update, UUID.randomUUID())).hasMessage("SESSION_ID_MISMATCH");
        assertThatCode(() -> WorkoutInput.requireEditable(1, DEVICE, WorkoutInput.Status.ACTIVE, input)).doesNotThrowAnyException();
        assertThatThrownBy(() -> WorkoutInput.requireEditable(2, DEVICE, WorkoutInput.Status.ACTIVE, input)).hasMessage("VERSION_CONFLICT");
        assertThatThrownBy(() -> WorkoutInput.requireEditable(1, UUID.randomUUID(), WorkoutInput.Status.ACTIVE, input)).hasMessage("EDITOR_DEVICE_MISMATCH");
        assertThatThrownBy(() -> WorkoutInput.requireEditable(1, DEVICE, WorkoutInput.Status.COMPLETED, input)).hasMessage("SESSION_NOT_EDITABLE");
    }
    @Test void rejectsTrailingDocumentsInvalidUtf8AndOversizeInput() {
        assertThatThrownBy(() -> read(BODY + "{}", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> WorkoutInput.read(new ByteArrayInputStream(new byte[]{(byte)0xff}), null)).hasMessage("INVALID_WORKOUT_JSON");
        assertThatThrownBy(() -> WorkoutInput.read(new ByteArrayInputStream(new byte[WorkoutInput.MAX_BYTES + 1]), null)).hasMessage("WORKOUT_TOO_LARGE");
    }
    @Test void rejectsAerobicWithStrengthSetsAndInitialCancellation() {
        assertThatThrownBy(() -> read(BODY.replace("STRENGTH", "AEROBIC"), null)).hasMessage("INVALID_SESSION_TYPE_FIELDS");
        assertThatThrownBy(() -> read(BODY.replace("ACTIVE", "CANCELLED"), null)).hasMessage("INVALID_INITIAL_STATUS");
    }
    @Test void importConfirmationIsBoundedExplicitAndRejectsDuplicateFields() throws Exception {
        String valid="{\"confirmedSha256\":\""+"a".repeat(64)+"\",\"acceptPartialFields\":true}";
        var confirmation=WorkoutInput.readImportConfirmation(new ByteArrayInputStream(valid.getBytes(StandardCharsets.UTF_8)));
        assertThat(confirmation.acceptPartial()).isTrue();
        assertThatThrownBy(()->WorkoutInput.readImportConfirmation(new ByteArrayInputStream(valid.replace("true", "\"true\"").getBytes(StandardCharsets.UTF_8)))).hasMessage("INVALID_IMPORT_CONFIRMATION");
        assertThatThrownBy(()->WorkoutInput.readImportConfirmation(new ByteArrayInputStream(valid.replace("true}", "true,\"acceptPartialFields\":false}").getBytes(StandardCharsets.UTF_8)))).hasMessage("INVALID_IMPORT_CONFIRMATION");
        assertThatThrownBy(()->WorkoutInput.readImportConfirmation(new ByteArrayInputStream(new byte[1025]))).hasMessage("WORKOUT_TOO_LARGE");
    }
}
