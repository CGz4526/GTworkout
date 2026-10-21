package io.github.cgz4526.workout.workouts;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
import io.github.cgz4526.workout.backup.BackupService;
import io.github.cgz4526.workout.shared.ApiFailure;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Explicit import from immutable, already-owned backups. No reads from a browser's local database. */
@Service
public class WorkoutImportService {
    private final BackupService backups;
    private final WorkoutService workouts;
    private final WorkoutMapper db;
    private final JsonMapper json;
    public WorkoutImportService(BackupService backups,WorkoutService workouts,WorkoutMapper db,JsonMapper json) {
        this.backups=backups;this.workouts=workouts;this.db=db;this.json=json;
    }
    public record Preview(String backupId,String sha256,String timezone,int completedSessions,int unfinishedSkipped,
        int duplicateSessions,int conflictSessions,int invalidSessions,int templatesNotImported,int weightsNotImported,int photosNotImported,List<String> errors) {}
    public record Result(int imported,int alreadyPresent,int failed,List<String> errors) {}
    private record Prepared(Preview preview,List<WorkoutInput.Validated> sessions,Map<String,WorkoutInput.ExerciseInput> exercises) {}

    public Preview preview(String user,String backup) { return prepare(user,backup).preview(); }
    public Result commit(String user,String backup,String expectedSha,boolean acceptPartial) {
        var plan=prepare(user,backup);
        if(!plan.preview().sha256().equals(expectedSha)||!acceptPartial) throw new ApiFailure(409,"IMPORT_CONFIRMATION_REQUIRED");
        if(plan.preview().invalidSessions()>0||plan.preview().conflictSessions()>0) throw new ApiFailure(409,"IMPORT_NEEDS_REVIEW");
        int imported=0,already=0,failed=0;var errors=new ArrayList<String>();
        // Each session is atomic, not the whole file. Retrying reconstructs stable IDs and mutation bytes.
        for(var input:plan.sessions()) {
            try {
                var existing=db.find(user,input.sessionId().toString());
                if(existing!=null) { if(!same(existing,input)) throw new ApiFailure(409,"IMPORT_EXISTING_RECORD_CONFLICT"); already++;continue; }
                var session=json.readTree(input.payload()).path("session");
                for(var ex:session.path("exercises")) {
                    String id=ex.path("exerciseId").asString();
                    if(db.exercise(user,id)==null) {
                        try { workouts.createExercise(user,plan.exercises().get(id)); }
                        catch(ApiFailure e) { if(!e.code().equals("EXERCISE_ALREADY_EXISTS"))throw e; }
                    }
                }
                workouts.save(user,input);imported++;
            } catch(Exception ex) {
                failed++;if(errors.size()<20)errors.add(input.sessionId()+":"+(ex instanceof ApiFailure f?f.code():"IMPORT_WRITE_FAILED"));
            }
        }
        return new Result(imported,already,failed,errors);
    }
    private Prepared prepare(String user,String backupId) {
        workouts.requireEnabled();
        var metadata=backups.get(user,backupId);
        var root=json.readTree(backups.download(user,backupId));
        if(root.path("sessions").size()>1000) throw new ApiFailure(422,"IMPORT_BATCH_TOO_LARGE");
        var zone=ZoneId.of(metadata.timezone());
        var catalog=new HashMap<String,JsonNode>();for(var ex:root.path("exercises"))catalog.put(ex.path("id").asString(),ex);
        var exercises=new LinkedHashMap<String,WorkoutInput.ExerciseInput>();var sessions=new ArrayList<WorkoutInput.Validated>();
        var errors=new ArrayList<String>();int skipped=0,duplicates=0,conflicts=0,invalid=0,photos=0;
        for(var raw:root.path("sessions")) {
            photos+=raw.path("photos").size();
            if(!raw.path("finished").asBoolean(false)){skipped++;continue;}
            String source=raw.path("id").asString();
            try {
                var s=json.createObjectNode();
                String id=stable(user,"session",source).toString();
                boolean aerobic=raw.path("aerobic").asBoolean(false);
                boolean rest=!aerobic&&raw.path("exercises").isEmpty()&&(source.startsWith("rest-")||raw.path("templateName").asString("").equals("休息日"));
                if(!aerobic&&!rest&&raw.path("exercises").isEmpty()&&raw.path("startTime").asLong(0)==0) throw new IllegalArgumentException("AMBIGUOUS_SESSION_TYPE");
                var time=Instant.parse(raw.path("date").asString()).atZone(zone);
                s.put("id",id);s.put("type",aerobic?"AEROBIC":rest?"REST":"STRENGTH");s.put("status","COMPLETED");
                s.put("occurredAt",time.toInstant().toString());s.put("localDate",time.toLocalDate().toString());s.put("utcOffsetMinutes",time.getOffset().getTotalSeconds()/60);
                if(raw.hasNonNull("duration"))s.set("durationSeconds",raw.get("duration"));else s.put("durationSeconds",0);
                if(raw.hasNonNull("startTime")&&(!raw.path("startTime").isIntegralNumber()||!raw.path("startTime").canConvertToLong())) throw new IllegalArgumentException("INVALID_START_TIME");
                if(!rest&&raw.path("startTime").asLong(0)>0)s.put("startedAt",Instant.ofEpochMilli(raw.path("startTime").asLong()).toString());
                copyText(raw,s,"templateName");copyText(raw,s,"notes");copyText(raw,s,"diet");
                if(aerobic&&raw.hasNonNull("distance"))s.set("distanceKm",raw.get("distance"));
                var entries=s.putArray("exercises");int ordinal=0;
                for(var rawEx:raw.path("exercises")) {
                    String legacy=rawEx.path("exerciseId").asString();String exId=stable(user,"exercise",legacy).toString();
                    var library=catalog.getOrDefault(legacy,rawEx);
                    String name=library.path("name").asString(rawEx.path("exerciseName").asString(""));
                    var exIntent=json.createObjectNode();exIntent.put("mutationId",stable(user,"exercise-mutation",metadata.sha256()+"/"+legacy).toString());
                    exIntent.put("id",exId);exIntent.put("name",name.strip());exIntent.put("bodyPart",library.path("bodyPart").asString("未知").strip());
                    if(library.hasNonNull("restSeconds"))exIntent.set("restSeconds",library.get("restSeconds"));else exIntent.put("restSeconds",150);
                    exercises.putIfAbsent(exId,WorkoutInput.readExercise(new ByteArrayInputStream(json.writeValueAsBytes(exIntent))));
                    var ex=entries.addObject();String exRecord=stable(user,"session-exercise",source+"/"+ordinal++).toString();
                    ex.put("id",exRecord);ex.put("exerciseId",exId);ex.put("exerciseName",rawEx.path("exerciseName").asString(name).strip());
                    if(rawEx.hasNonNull("restSeconds"))ex.set("restSeconds",rawEx.get("restSeconds"));else ex.set("restSeconds",exIntent.get("restSeconds"));
                    var sets=ex.putArray("sets");int setOrdinal=0;
                    for(var rawSet:rawEx.path("sets")) {
                        var set=sets.addObject();set.put("id",stable(user,"set",exRecord+"/"+setOrdinal++).toString());
                        if(rawSet.hasNonNull("weight"))set.set("weightKg",rawSet.get("weight"));
                        if(rawSet.hasNonNull("reps"))set.set("reps",rawSet.get("reps"));
                        if(rawSet.hasNonNull("rpe"))set.set("rpe",rawSet.get("rpe"));
                        set.put("completed",rawSet.path("completed").asBoolean(false));set.put("warmup",rawSet.path("warmup").asBoolean(false));
                    }
                }
                var request=json.createObjectNode();request.put("mutationId",stable(user,"session-mutation",metadata.sha256()+"/"+metadata.timezone()+"/"+source).toString());request.put("expectedVersion",0);
                request.put("deviceId",stable(user,"import-device","v1").toString());request.set("session",s);
                var input=WorkoutInput.read(new ByteArrayInputStream(json.writeValueAsBytes(request)),null);
                var existing=db.find(user,id);
                if(existing!=null){if(same(existing,input))duplicates++;else conflicts++;}
                sessions.add(input);
            } catch(Exception ex) {invalid++;if(errors.size()<20)errors.add(source+":INVALID_OR_UNSUPPORTED_SESSION");}
        }
        var preview=new Preview(backupId,metadata.sha256(),metadata.timezone(),sessions.size(),skipped,duplicates,conflicts,invalid,root.path("templates").size(),root.path("weights").size(),photos,errors);
        return new Prepared(preview,sessions,exercises);
    }
    private boolean same(WorkoutMapper.SessionRow row,WorkoutInput.Validated input) {
        return json.readTree(row.document()).equals(json.readTree(input.payload()).path("session"));
    }
    private void copyText(JsonNode from,tools.jackson.databind.node.ObjectNode to,String field) {
        String value=from.path(field).asString(null);if(value!=null&&!value.isBlank())to.put(field,value.strip());
    }
    private UUID stable(String user,String type,String source) {
        return UUID.nameUUIDFromBytes(("workout-import-v1/"+user+"/"+type+"/"+source).getBytes(StandardCharsets.UTF_8));
    }
}
