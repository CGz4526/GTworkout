package io.github.cgz4526.workout.workouts;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.github.cgz4526.workout.shared.ApiFailure;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class WorkoutService {
    private final WorkoutMapper db;
    private final JsonMapper json;
    private final boolean enabled;
    public WorkoutService(WorkoutMapper db, JsonMapper json, @Value("${workout.training-write-enabled:false}") boolean enabled) {
        this.db=db; this.json=json; this.enabled=enabled;
    }
    public void requireEnabled() { if (!enabled) throw new ApiFailure(503,"TRAINING_NOT_ENABLED"); }
    public record View(JsonNode session,long version,String editorDeviceId,String updatedAt) {
        @Override public String toString() { return "View[redacted]"; }
    }
    public record Page(List<View> items,String nextCursor) {}
    public record ExercisePage(List<WorkoutMapper.ExerciseRow> items,String nextCursor) {}

    @Transactional
    public JsonNode save(String user, WorkoutInput.Validated input) {
        requireEnabled(); lock(user);
        String id=input.sessionId().toString();
        String kind=input.expectedVersion()==0 ? "SESSION_CREATE" : "SESSION_UPDATE";
        JsonNode replay=replay(user,input.mutationId().toString(),input.requestSha256(),kind,id);
        if(replay!=null) return replay;
        var old=db.find(user,id);
        JsonNode s=json.readTree(input.payload()).path("session");
        if(input.expectedVersion()==0) {
            if(old!=null) throw new ApiFailure(409,"SESSION_ALREADY_EXISTS");
            if(db.sessionCount(user)>=10000) throw new ApiFailure(429,"TRAINING_QUOTA_EXCEEDED");
        } else {
            if(old==null) throw new ApiFailure(404,"SESSION_NOT_FOUND");
            try { WorkoutInput.requireEditable(old.version(),UUID.fromString(old.editorDeviceId()),WorkoutInput.Status.valueOf(old.status()),input); }
            catch(IllegalArgumentException ex) { throw new ApiFailure(409,ex.getMessage()); }
            if(!old.type().equals(input.type().name())) throw new ApiFailure(409,"SESSION_TYPE_CHANGED");
        }
        if(input.status()==WorkoutInput.Status.ACTIVE) {
            String active=db.active(user);
            if(active!=null&&!active.equals(id)) throw new ApiFailure(409,"ACTIVE_SESSION_EXISTS");
        }
        for(var ex:s.path("exercises")) {
            String parent=db.exerciseParent(user,ex.path("id").asString());
            if(parent!=null&&!parent.equals(id)) throw new ApiFailure(409,"CHILD_ID_CONFLICT");
            if(db.exercise(user,ex.path("exerciseId").asString())==null) throw new ApiFailure(422,"EXERCISE_NOT_FOUND");
            for(var set:ex.path("sets")) {
                parent=db.setParent(user,set.path("id").asString());
                if(parent!=null&&!parent.equals(id)) throw new ApiFailure(409,"CHILD_ID_CONFLICT");
            }
        }
        var data=new WorkoutMapper.SessionWrite(user,id,input.type().name(),input.status().name(),s.path("occurredAt").asString(),s.path("localDate").asString(),s.path("utcOffsetMinutes").asInt(),
            nullable(s,"startedAt"),nullable(s,"finishedAt"),s.path("durationSeconds").asInt(),nullable(s,"templateName"),nullable(s,"notes"),nullable(s,"diet"),nullable(s,"distanceKm"),input.deviceId().toString(),json.writeValueAsString(s));
        if(old==null) db.insert(data); else {
            db.update(data); db.replaceSets(user,id); db.replaceExercises(user,id);
        }
        int position=0;
        for(var ex:s.path("exercises")) {
            String exId=ex.path("id").asString();
            db.addExercise(user,id,exId,ex.path("exerciseId").asString(),ex.path("exerciseName").asString(),ex.path("restSeconds").asInt(),position++);
            int setPosition=0;
            for(var set:ex.path("sets")) db.addSet(user,id,exId,set.path("id").asString(),setPosition++,nullable(set,"weightKg"),nullable(set,"reps"),set.path("completed").asBoolean(),set.path("warmup").asBoolean(),nullable(set,"rpe"));
        }
        JsonNode result=json.readTree(json.writeValueAsString(view(db.find(user,id))));
        db.remember(user,input.mutationId().toString(),input.requestSha256(),kind,id,json.writeValueAsString(result));
        return result;
    }

    @Transactional
    public JsonNode createExercise(String user, WorkoutInput.ExerciseInput input) {
        requireEnabled(); lock(user);
        JsonNode replay=replay(user,input.mutationId().toString(),input.sha(),"EXERCISE_CREATE",input.id().toString());
        if(replay!=null) return replay;
        if(db.exercise(user,input.id().toString())!=null) throw new ApiFailure(409,"EXERCISE_ALREADY_EXISTS");
        var row=new WorkoutMapper.ExerciseRow(input.id().toString(),input.name(),input.bodyPart(),input.restSeconds());
        db.insertExercise(user,row);
        JsonNode result=json.valueToTree(row);
        db.remember(user,input.mutationId().toString(),input.sha(),"EXERCISE_CREATE",input.id().toString(),json.writeValueAsString(result));
        return result;
    }
    public View get(String user,String id) {
        requireEnabled(); uuid(id);
        var row=db.find(user,id); if(row==null) throw new ApiFailure(404,"SESSION_NOT_FOUND");
        return view(row);
    }
    public Page list(String user,int limit,String cursor) {
        requireEnabled(); limit(limit);
        OffsetDateTime cutoff=OffsetDateTime.now(),before=null; String beforeId=null;
        if(cursor!=null) try {
            if(cursor.length()>512) throw new IllegalArgumentException();
            String[] bits=new String(Base64.getUrlDecoder().decode(cursor),StandardCharsets.UTF_8).split("\\|",-1);
            if(bits.length!=3) throw new IllegalArgumentException();
            cutoff=OffsetDateTime.parse(bits[0]); before=OffsetDateTime.parse(bits[1]); beforeId=uuid(bits[2]);
        } catch(Exception ex) { throw new ApiFailure(422,"INVALID_CURSOR"); }
        List<View> rows=db.list(user,cutoff,before,beforeId,limit+1).stream().map(this::view).toList();
        String next=null;
        if(rows.size()>limit) {
            var last=rows.get(limit-1).session();
            next=Base64.getUrlEncoder().withoutPadding().encodeToString((cutoff+"|"+last.path("occurredAt").asString()+"|"+last.path("id").asString()).getBytes(StandardCharsets.UTF_8));
            rows=rows.subList(0,limit);
        }
        return new Page(rows,next);
    }
    public ExercisePage exercises(String user,int limit,String cursor) {
        requireEnabled(); limit(limit); if(cursor!=null) uuid(cursor);
        var rows=db.exercises(user,cursor,limit+1); String next=null;
        if(rows.size()>limit) { next=rows.get(limit-1).id(); rows=rows.subList(0,limit); }
        return new ExercisePage(rows,next);
    }
    private View view(WorkoutMapper.SessionRow row) { return new View(json.readTree(row.document()),row.version(),row.editorDeviceId(),row.updatedAt()); }
    private void lock(String user) { if(db.lockUser(user)==null) throw new ApiFailure(401,"AUTHENTICATION_REQUIRED"); }
    private JsonNode replay(String user,String mutation,String sha,String kind,String resource) {
        var prior=db.mutation(user,mutation);
        if(prior!=null) {
            if(!prior.requestSha256().equals(sha)||!prior.resourceType().equals(kind)||!prior.resourceId().equals(resource)) throw new ApiFailure(409,"IDEMPOTENCY_KEY_REUSED");
            return json.readTree(prior.responseJson());
        }
        if(db.mutations(user)>=100000) throw new ApiFailure(429,"TRAINING_QUOTA_EXCEEDED");
        return null;
    }
    private static String nullable(JsonNode node,String key) { var n=node.path(key); return n.isMissingNode()||n.isNull()?null:n.asString(); }
    private static void limit(int limit) { if(limit<1||limit>100) throw new ApiFailure(422,"INVALID_LIMIT"); }
    private static String uuid(String id) {
        try { if(id==null||!UUID.fromString(id).toString().equalsIgnoreCase(id)) throw new IllegalArgumentException(); return id; }
        catch(IllegalArgumentException ex) { throw new ApiFailure(404,"SESSION_NOT_FOUND"); }
    }
}
