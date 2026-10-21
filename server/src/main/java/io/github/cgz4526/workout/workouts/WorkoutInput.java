package io.github.cgz4526.workout.workouts;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Pure boundary validation: no authentication, database access or persistence claims. */
public final class WorkoutInput {
    public static final int MAX_BYTES = 1024 * 1024;
    private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final JsonMapper JSON = JsonMapper.builder(JsonFactory.builder()
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(12)
            .maxTokenCount(100000).maxStringLength(8192).maxNumberLength(32).build())
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build()).build();

    public enum Status { ACTIVE, COMPLETED, CANCELLED }
    public enum Type { STRENGTH, AEROBIC, REST }
    public record Validated(UUID mutationId, UUID sessionId, UUID deviceId, long expectedVersion,
                            Status status, Type type, String requestSha256, String payload) {
        @Override public String toString() { return "Validated[redacted]"; }
    }
    public record ExerciseInput(UUID mutationId, UUID id, String name, String bodyPart, int restSeconds, String sha) {
        @Override public String toString() { return "ExerciseInput[redacted]"; }
    }
    public record ImportConfirmation(String sha256, boolean acceptPartial) {}

    private WorkoutInput() {}

    public static ImportConfirmation readImportConfirmation(InputStream input) throws IOException {
        byte[] bytes = input.readNBytes(1025);
        if (bytes.length > 1024) throw invalid("WORKOUT_TOO_LARGE");
        try (var parser = JSON.createParser(bytes)) {
            var node = JSON.readTree(parser);
            if (parser.nextToken() != null) throw invalid("INVALID_IMPORT_CONFIRMATION");
            fields(node, "confirmedSha256", "acceptPartialFields");
            String sha = text(node, "confirmedSha256", 64, false);
            if (!sha.matches("[0-9a-f]{64}") || !node.path("acceptPartialFields").isBoolean()) throw invalid("INVALID_IMPORT_CONFIRMATION");
            return new ImportConfirmation(sha, node.path("acceptPartialFields").asBoolean());
        } catch (IllegalArgumentException ex) { throw ex; }
        catch (Exception ex) { throw invalid("INVALID_IMPORT_CONFIRMATION"); }
    }

    public static ExerciseInput readExercise(InputStream input) throws IOException {
        byte[] bytes = input.readNBytes(4097);
        if (bytes.length > 4096) throw invalid("WORKOUT_TOO_LARGE");
        try {
            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes));
            JsonNode root;
            try (var parser = JSON.createParser(bytes)) {
                root = JSON.readTree(parser);
                if (parser.nextToken() != null) throw invalid("INVALID_WORKOUT_JSON");
            }
            fields(root, "mutationId", "id", "name", "bodyPart", "restSeconds");
            return new ExerciseInput(uuid(root, "mutationId"), uuid(root, "id"), text(root, "name", 100, false),
                text(root, "bodyPart", 32, false), (int)integer(root, "restSeconds", 30, 600, false),
                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));
        } catch (IllegalArgumentException ex) { throw ex; }
        catch (Exception ex) { throw invalid("INVALID_WORKOUT_JSON"); }
    }

    public static Validated read(InputStream input, UUID pathId) throws IOException {
        byte[] bytes = input.readNBytes(MAX_BYTES + 1);
        if (bytes.length > MAX_BYTES) throw invalid("WORKOUT_TOO_LARGE");
        try {
            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes));
            JsonNode root;
            try (var parser = JSON.createParser(bytes)) {
                root = JSON.readTree(parser);
                if (parser.nextToken() != null) throw invalid("INVALID_WORKOUT_JSON");
            }
            fields(root, "mutationId", "expectedVersion", "deviceId", "session");
            UUID mutation = uuid(root, "mutationId"), device = uuid(root, "deviceId");
            long version = integer(root, "expectedVersion", 0, Long.MAX_VALUE, false);
            if ((pathId == null && version != 0) || (pathId != null && version == 0)) throw invalid("INVALID_EXPECTED_VERSION");
            JsonNode session = root.path("session");
            fields(session, "id", "type", "status", "occurredAt", "localDate", "utcOffsetMinutes",
                "startedAt", "finishedAt", "durationSeconds", "templateName", "notes", "diet", "distanceKm", "exercises");
            UUID id = uuid(session, "id");
            if (pathId != null && !pathId.equals(id)) throw invalid("SESSION_ID_MISMATCH");
            Type type;
            Status status;
            try {
                type = Type.valueOf(text(session, "type", 16, false));
                status = Status.valueOf(text(session, "status", 16, false));
            } catch (IllegalArgumentException ex) { throw invalid("INVALID_SESSION_STATE"); }
            if (pathId == null && status == Status.CANCELLED) throw invalid("INVALID_INITIAL_STATUS");
            Instant occurred = Instant.parse(text(session, "occurredAt", 64, false));
            int offset = (int) integer(session, "utcOffsetMinutes", -840, 840, false);
            LocalDate day = LocalDate.parse(text(session, "localDate", 10, false));
            if (!occurred.atOffset(ZoneOffset.ofTotalSeconds(offset * 60)).toLocalDate().equals(day)) throw invalid("LOCAL_DATE_MISMATCH");
            long duration = integer(session, "durationSeconds", 0, 604800, false);
            Instant start = instant(session, "startedAt"), finish = instant(session, "finishedAt");
            if (start != null && finish != null && finish.isBefore(start)) throw invalid("INVALID_TIME_ORDER");
            if (status == Status.ACTIVE && finish != null) throw invalid("INVALID_FINISHED_AT");
            text(session, "templateName", 100, true); text(session, "notes", 2000, true);
            String diet = text(session, "diet", 8, true);
            if (diet != null && !Set.of("low", "mid", "high", "cheat").contains(diet)) throw invalid("INVALID_DIET");
            decimal(session, "distanceKm", 10000, 3);
            JsonNode exercises = array(session, "exercises", 100);
            if (type != Type.STRENGTH && !exercises.isEmpty()) throw invalid("INVALID_SESSION_TYPE_FIELDS");
            if (type != Type.AEROBIC && present(session, "distanceKm")) throw invalid("INVALID_SESSION_TYPE_FIELDS");
            if (type == Type.REST && (status != Status.COMPLETED || duration != 0 || start != null || finish != null)) throw invalid("INVALID_REST_SESSION");
            Set<UUID> exerciseIds = new HashSet<>(), setIds = new HashSet<>();
            int total = 0;
            for (JsonNode exercise : exercises) {
                fields(exercise, "id", "exerciseId", "exerciseName", "restSeconds", "sets");
                if (!exerciseIds.add(uuid(exercise, "id"))) throw invalid("DUPLICATE_EXERCISE_RECORD_ID");
                uuid(exercise, "exerciseId"); text(exercise, "exerciseName", 100, false);
                integer(exercise, "restSeconds", 30, 600, false);
                for (JsonNode set : array(exercise, "sets", 100)) {
                    if (++total > 2000) throw invalid("TOO_MANY_SETS");
                    fields(set, "id", "weightKg", "reps", "completed", "warmup", "rpe");
                    if (!setIds.add(uuid(set, "id"))) throw invalid("DUPLICATE_SET_ID");
                    decimal(set, "weightKg", 1000, 3);
                    integer(set, "reps", 0, 10000, true);
                    if (!set.path("completed").isBoolean() || !set.path("warmup").isBoolean()) throw invalid("INVALID_SET_FLAGS");
                    BigDecimal rpe = decimal(set, "rpe", 10, 1);
                    if (rpe != null && (rpe.compareTo(BigDecimal.valueOf(6)) < 0 || rpe.remainder(new BigDecimal("0.5")).signum() != 0)) throw invalid("INVALID_RPE");
                }
            }
            String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            return new Validated(mutation, id, device, version, status, type, digest, new String(bytes, StandardCharsets.UTF_8));
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw invalid("INVALID_WORKOUT_JSON");
        }
    }

    public static void requireEditable(long currentVersion, UUID editor, Status current, Validated input) {
        if (currentVersion != input.expectedVersion()) throw invalid("VERSION_CONFLICT");
        if (!editor.equals(input.deviceId())) throw invalid("EDITOR_DEVICE_MISMATCH");
        if (current != Status.ACTIVE) throw invalid("SESSION_NOT_EDITABLE");
    }

    private static void fields(JsonNode node, String... names) {
        if (node == null || !node.isObject()) throw invalid("INVALID_OBJECT");
        Set<String> allowed = Set.of(names);
        for (String name : node.propertyNames()) if (!allowed.contains(name)) throw invalid("UNKNOWN_FIELD");
    }
    private static boolean present(JsonNode node, String name) { return !node.path(name).isMissingNode() && !node.path(name).isNull(); }
    private static String text(JsonNode node, String name, int max, boolean optional) {
        if (!present(node, name) && optional) return null;
        JsonNode value = node.path(name);
        if (!value.isString()) throw invalid("INVALID_" + name);
        String text = value.asString();
        if (text.isBlank() || text.codePointCount(0, text.length()) > max || !text.equals(text.strip())) throw invalid("INVALID_" + name);
        return text;
    }
    private static UUID uuid(JsonNode node, String name) {
        String value = text(node, name, 36, false);
        if (!UUID_TEXT.matcher(value).matches()) throw invalid("INVALID_" + name);
        return UUID.fromString(value);
    }
    private static long integer(JsonNode node, String name, long min, long max, boolean optional) {
        if (!present(node, name) && optional) return 0;
        JsonNode value = node.path(name);
        if (!value.isIntegralNumber() || !value.canConvertToLong()) throw invalid("INVALID_" + name);
        long number = value.asLong();
        if (number < min || number > max) throw invalid("INVALID_" + name);
        return number;
    }
    private static BigDecimal decimal(JsonNode node, String name, int max, int scale) {
        if (!present(node, name)) return null;
        JsonNode value = node.path(name);
        if (!value.isNumber()) throw invalid("INVALID_" + name);
        BigDecimal number = new BigDecimal(value.asString());
        if (number.signum() < 0 || number.compareTo(BigDecimal.valueOf(max)) > 0 || number.stripTrailingZeros().scale() > scale) throw invalid("INVALID_" + name);
        return number;
    }
    private static Instant instant(JsonNode node, String name) {
        String value = text(node, name, 64, true);
        return value == null ? null : Instant.parse(value);
    }
    private static JsonNode array(JsonNode node, String name, int max) {
        JsonNode value = node.path(name);
        if (!value.isArray() || value.size() > max) throw invalid("INVALID_" + name);
        return value;
    }
    private static IllegalArgumentException invalid(String code) { return new IllegalArgumentException(code); }
}
