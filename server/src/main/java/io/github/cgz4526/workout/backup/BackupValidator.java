package io.github.cgz4526.workout.backup;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;
import org.springframework.stereotype.Component;
import io.github.cgz4526.workout.shared.ApiFailure;
import tools.jackson.core.JsonToken;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class BackupValidator {
    public static final int MAX_BYTES = 20 * 1024 * 1024;
    private final JsonMapper json = JsonMapper.builder(JsonFactory.builder()
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(32).maxTokenCount(1_000_000)
            .maxNumberLength(32).maxNameLength(16384).maxStringLength(8 * 1024 * 1024).build())
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build()).build();

    public ValidatedBackup validate(InputStream input) throws IOException {
        byte[] bytes = input.readNBytes(MAX_BYTES + 1);
        if (bytes.length > MAX_BYTES) throw new ApiFailure(413, "BACKUP_TOO_LARGE");
        if (bytes.length == 0) throw invalid();
        try {
            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes));
            // Validate parsing budgets before constructing any object tree.
            try (var parser = json.createParser(bytes)) {
                if (parser.nextToken() != JsonToken.START_OBJECT) throw invalid();
                while (parser.nextToken() != null) {
                    if (parser.currentToken() == JsonToken.VALUE_STRING && parser.getStringLength() > 16384
                            && !parser.streamReadContext().pathAsPointer().toString().matches("/sessions/[0-9]+/photos/[0-9]+")) {
                        throw invalid();
                    }
                }
            }
            JsonNode root;
            try (var parser = json.createParser(bytes)) {
                root = json.readTree(parser);
                if (parser.nextToken() != null) throw invalid();
            }
            if (!root.path("version").isIntegralNumber()) throw invalid();
            int version = root.path("version").asInt();
            if (version < 1 || version > 3 || !root.path("version").toString().equals(Integer.toString(version))) {
                throw new ApiFailure(422, "UNSUPPORTED_BACKUP_VERSION");
            }
            JsonNode exercises = array(root, "exercises", 5000, true);
            JsonNode templates = array(root, "templates", 1000, true);
            JsonNode sessions = array(root, "sessions", 20000, true);
            JsonNode weights = array(root, "weights", 20000, version != 1);
            uniqueIds(exercises); uniqueIds(templates); uniqueIds(sessions);
            for (var exercise : exercises) { text(exercise, "name", true); text(exercise, "bodyPart", true); number(exercise, "restSeconds", 30, 600, true); }
            for (var template : templates) {
                text(template, "name", true);
                for (var item : array(template, "items", 1000, false)) {
                    object(item); text(item, "exerciseId", true); text(item, "exerciseName", false);
                    number(item, "defaultSets", 1, 20, true); number(item, "defaultReps", 1, 100, true);
                    number(item, "restSeconds", 30, 600, true);
                }
            }
            int groupCount = 0;
            for (var session : sessions) {
                Instant.parse(text(session, "date", true));
                bool(session, "finished"); bool(session, "aerobic");
                number(session, "duration", 0, 604800, true); number(session, "distance", 0, 10000, false);
                number(session, "weight", Double.MIN_VALUE, 1000, false);
                number(session, "startTime", 0, 9999999999999d, true);
                number(session, "restEndTime", 0, 9999999999999d, true);
                text(session, "notes", false);
                for (var photo : array(session, "photos", 3, false)) if (!photo.isString()) throw invalid();
                for (var exercise : array(session, "exercises", 5000, false)) {
                    object(exercise); text(exercise, "exerciseId", true); text(exercise, "exerciseName", false);
                    number(exercise, "restSeconds", 30, 600, true);
                    for (var group : array(exercise, "sets", 1000, false)) {
                        if (++groupCount > 100000) throw invalid();
                        object(group); bool(group, "completed"); bool(group, "warmup");
                        number(group, "weight", 0, 2000, false); number(group, "reps", 0, 1000, true);
                        number(group, "rpe", 6, 10, false);
                        if (group.has("rpe") && group.get("rpe").asDouble() * 2 % 1 != 0) throw invalid();
                    }
                }
            }
            Set<String> days = new HashSet<>();
            for (var weight : weights) {
                object(weight);
                String date = text(weight, "date", true);
                if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || !days.add(LocalDate.parse(date).toString())) throw invalid();
                if (!weight.has("weight")) throw invalid();
                number(weight, "weight", Double.MIN_VALUE, 1000, false);
                number(weight, "updatedAt", 0, 9999999999999d, true);
            }
            return new ValidatedBackup(bytes, MessageDigest.getInstance("SHA-256").digest(bytes), version,
                    exercises.size(), templates.size(), sessions.size(), weights.size());
        } catch (ApiFailure ex) { throw ex; }
        catch (Exception ex) { throw invalid(); }
    }

    private JsonNode array(JsonNode parent, String name, int max, boolean required) {
        if (!parent.has(name) && !required) return json.createArrayNode();
        var node = parent.path(name);
        if (!node.isArray() || node.size() > max) throw invalid();
        return node;
    }
    private static void object(JsonNode node) { if (!node.isObject()) throw invalid(); }
    private static void uniqueIds(JsonNode nodes) {
        Set<String> ids = new HashSet<>();
        for (var node : nodes) {
            object(node);
            String id = text(node, "id", true);
            if (id.length() > 128 || !ids.add(id)) throw invalid();
        }
    }
    private static String text(JsonNode node, String field, boolean required) {
        if (!node.has(field) && !required) return null;
        var value = node.path(field);
        if (!value.isString() || (required && value.asString().isBlank()) || value.asString().length() > 16384) throw invalid();
        return value.asString();
    }
    private static void bool(JsonNode node, String field) {
        if (node.has(field) && !node.get(field).isBoolean()) throw invalid();
    }
    private static void number(JsonNode node, String field, double min, double max, boolean integral) {
        if (!node.has(field)) return;
        var value = node.get(field);
        if (!value.isNumber()) throw invalid();
        double n = value.asDouble();
        if (!Double.isFinite(n) || n < min || n > max || (integral && n % 1 != 0)) throw invalid();
    }
    private static ApiFailure invalid() { return new ApiFailure(422, "INVALID_BACKUP"); }

    public record ValidatedBackup(byte[] bytes, byte[] digest, int version, int exerciseCount,
                                  int templateCount, int sessionCount, int weightCount) {
        @Override public String toString() { return "ValidatedBackup[redacted]"; }
    }
}
