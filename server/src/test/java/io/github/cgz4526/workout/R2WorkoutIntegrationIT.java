package io.github.cgz4526.workout;

import java.io.ByteArrayInputStream;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import io.github.cgz4526.workout.identity.IdentityService;
import io.github.cgz4526.workout.identity.UserAccount;
import io.github.cgz4526.workout.shared.ApiFailure;
import io.github.cgz4526.workout.workouts.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

@TestPropertySource(properties="workout.training-write-enabled=true")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class R2WorkoutIntegrationIT extends PostgresTestBase {
    @Autowired WorkoutService service;
    @Autowired IdentityService identity;
    @Autowired JdbcTemplate jdbc;
    @Autowired WorkoutImportService imports;
    @Autowired io.github.cgz4526.workout.backup.BackupService backups;
    @Autowired io.github.cgz4526.workout.backup.BackupValidator validator;
    @Value("${local.server.port}") int port;
    final JsonMapper json=JsonMapper.builder().build();
    static final String PASSWORD="synthetic-training-password";

    UserAccount.PublicUser account() { return identity.register("r2_"+UUID.randomUUID().toString().replace("-","").substring(0,18),PASSWORD); }
    UUID id() { return UUID.randomUUID(); }
    String exercise(String user) throws Exception {
        String id=id().toString();
        service.createExercise(user,WorkoutInput.readExercise(new ByteArrayInputStream(json.writeValueAsBytes(Map.of("mutationId",id(),"id",id,"name","合成深蹲","bodyPart","腿","restSeconds",150)))));
        return id;
    }
    String body(UUID session,UUID device,String exercise,UUID child,UUID set,long version,String status) {
        return json.writeValueAsString(Map.of("mutationId",id(),"deviceId",device,"expectedVersion",version,"session",Map.of(
            "id",session,"type","STRENGTH","status",status,"occurredAt","2026-10-15T17:00:00Z","localDate","2026-10-16","utcOffsetMinutes",480,
            "durationSeconds",120,"exercises",List.of(Map.of("id",child,"exerciseId",exercise,"exerciseName","合成深蹲","restSeconds",150,
                "sets",List.of(Map.of("id",set,"weightKg",40,"reps",10,"completed",true,"warmup",false)))))));
    }
    WorkoutInput.Validated input(String text,UUID path) throws Exception { return WorkoutInput.read(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)),path); }

    @Test void storesRelationalRowsAndReplaysLostResponseAfterVersionChanged() throws Exception {
        String user=account().id(),ex=exercise(user); UUID session=id(),device=id(),child=id(),set=id();
        var create=input(body(session,device,ex,child,set,0,"ACTIVE"),null);
        assertThat(service.save(user,create).path("version").asLong()).isEqualTo(1);
        var update=input(body(session,device,ex,child,set,1,"COMPLETED"),session);
        assertThat(service.save(user,update).path("version").asLong()).isEqualTo(2);
        assertThat(service.save(user,create).path("version").asLong()).isEqualTo(1);
        assertThat(service.get(user,session.toString()).version()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM live_set WHERE user_id=?::uuid AND session_id=?::uuid",Integer.class,user,session.toString())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT sum(weight_kg*reps) FROM live_set WHERE user_id=?::uuid AND session_id=?::uuid",Integer.class,user,session.toString())).isEqualTo(400);
    }
    @Test void concurrentSameKeyCreatesOnceAndVersionRaceHasOneWinner() throws Exception {
        String user=account().id(),ex=exercise(user); UUID session=id(),device=id(),child=id(),set=id();
        var create=input(body(session,device,ex,child,set,0,"ACTIVE"),null);
        var pool=Executors.newFixedThreadPool(2);
        try {
            var a=pool.submit(()->service.save(user,create)); var b=pool.submit(()->service.save(user,create));
            assertThat(a.get(15,TimeUnit.SECONDS)).isEqualTo(b.get(15,TimeUnit.SECONDS));
            var one=input(body(session,device,ex,child,set,1,"ACTIVE"),session);
            var two=input(body(session,device,ex,child,set,1,"COMPLETED"),session);
            Callable<String> c1=()->{try{service.save(user,one);return "OK";}catch(ApiFailure e){return e.code();}};
            Callable<String> c2=()->{try{service.save(user,two);return "OK";}catch(ApiFailure e){return e.code();}};
            var x=pool.submit(c1);var y=pool.submit(c2);
            assertThat(List.of(x.get(15,TimeUnit.SECONDS),y.get(15,TimeUnit.SECONDS))).containsExactlyInAnyOrder("OK","VERSION_CONFLICT");
        } finally { pool.shutdownNow(); }
    }
    @Test void rejectsCrossAccountReadWriteReferencesAndExpectedVersion() throws Exception {
        String a=account().id(),b=account().id(),ex=exercise(a);UUID s=id(),d=id(),child=id(),set=id();
        service.save(a,input(body(s,d,ex,child,set,0,"ACTIVE"),null));
        assertThatThrownBy(()->service.get(b,s.toString())).isInstanceOf(ApiFailure.class).hasMessage("SESSION_NOT_FOUND");
        assertThatThrownBy(()->service.save(b,input(body(s,d,ex,child,set,1,"ACTIVE"),s))).hasMessage("SESSION_NOT_FOUND");
        assertThatThrownBy(()->service.save(b,input(body(id(),d,ex,id(),id(),0,"COMPLETED"),null))).hasMessage("EXERCISE_NOT_FOUND");
        assertThatThrownBy(()->service.save(a,input(body(s,id(),ex,child,set,1,"ACTIVE"),s))).hasMessage("EDITOR_DEVICE_MISMATCH");
    }
    @Test void rejectsKeyReuseAndCrossSessionChildIdentityAndSupportsCancellation() throws Exception {
        String user=account().id(),ex=exercise(user);UUID s=id(),d=id(),child=id(),set=id();
        String first=body(s,d,ex,child,set,0,"ACTIVE");
        service.save(user,input(first,null));
        assertThatThrownBy(()->service.save(user,input(first.replace("\"reps\":10","\"reps\":11"),null))).hasMessage("IDEMPOTENCY_KEY_REUSED");
        assertThatThrownBy(()->service.save(user,input(body(id(),d,ex,child,id(),0,"COMPLETED"),null))).hasMessage("CHILD_ID_CONFLICT");
        assertThatThrownBy(()->service.save(user,input(body(id(),d,ex,id(),id(),0,"ACTIVE"),null))).hasMessage("ACTIVE_SESSION_EXISTS");
        service.save(user,input(body(s,d,ex,child,set,1,"CANCELLED"),s));
        assertThat(service.list(user,20,null).items()).isEmpty();
        assertThat(service.save(user,input(body(id(),d,ex,id(),id(),0,"ACTIVE"),null)).path("version").asLong()).isEqualTo(1);
    }
    @Test void rollsBackAggregateAndIdempotencyWhenChildInsertFails() throws Exception {
        String user=account().id(),ex=exercise(user);UUID s=id();
        jdbc.execute("CREATE FUNCTION r2_fail_set() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.weight_kg=777 THEN RAISE EXCEPTION ''synthetic failure''; END IF; RETURN NEW; END'");
        jdbc.execute("CREATE TRIGGER r2_fail_set BEFORE INSERT ON live_set FOR EACH ROW EXECUTE FUNCTION r2_fail_set()");
        try {
            var data=input(body(s,id(),ex,id(),id(),0,"COMPLETED").replace("\"weightKg\":40","\"weightKg\":777"),null);
            assertThatThrownBy(()->service.save(user,data)).isInstanceOf(RuntimeException.class);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM live_session WHERE user_id=?::uuid",Integer.class,user)).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM training_mutation WHERE user_id=?::uuid AND resource_type<>'EXERCISE_CREATE'",Integer.class,user)).isZero();
        } finally { // Only test-owned fault injection objects, not user schema/data.
            jdbc.execute("DROP TRIGGER r2_fail_set ON live_set"); jdbc.execute("DROP FUNCTION r2_fail_set()");
        }
    }
    @Test void pagesEqualTimestampsWithoutOmittingSessions() throws Exception {
        String user=account().id(),ex=exercise(user);
        for(int i=0;i<3;i++) service.save(user,input(body(id(),id(),ex,id(),id(),0,"COMPLETED"),null));
        var page=service.list(user,2,null);assertThat(page.items()).hasSize(2);assertThat(page.nextCursor()).isNotNull();
        var next=service.list(user,2,page.nextCursor());assertThat(next.items()).hasSize(1);assertThat(next.nextCursor()).isNull();
        Set<String> ids=new HashSet<>();page.items().forEach(v->ids.add(v.session().path("id").asString()));next.items().forEach(v->ids.add(v.session().path("id").asString()));assertThat(ids).hasSize(3);
    }
    @Test void importsImmutableBackupWithStableIdsAndExplicitPartialFieldConsent() throws Exception {
        String user=account().id();
        byte[] bytes=("""
            {"version":3,"exercises":[{"id":"legacy-squat","name":"合成深蹲","bodyPart":"腿"}],"templates":[],"weights":[{"date":"2026-10-16","weight":70}],
            "sessions":[{"id":"legacy-session","date":"2026-10-15T17:00:00Z","duration":120,"finished":true,"startTime":1792083600000,"templateName":"合成训练",
            "exercises":[{"exerciseId":"legacy-squat","exerciseName":"合成深蹲","sets":[{"weight":40,"reps":10,"completed":true}]}]}]}
            """).getBytes(StandardCharsets.UTF_8);
        var validated=validator.validate(new ByteArrayInputStream(bytes));
        var backup=backups.save(user,io.github.cgz4526.workout.backup.UploadIdentity.fromDigest(id().toString(),"Asia/Shanghai",validated.digest()),validated).backup();
        var preview=imports.preview(user,backup.id());
        assertThat(preview.completedSessions()).isEqualTo(1);assertThat(preview.invalidSessions()).isZero();assertThat(preview.weightsNotImported()).isEqualTo(1);
        assertThatThrownBy(()->imports.commit(user,backup.id(),preview.sha256(),false)).hasMessage("IMPORT_CONFIRMATION_REQUIRED");
        var result=imports.commit(user,backup.id(),preview.sha256(),true);assertThat(result.imported()).isEqualTo(1);assertThat(result.failed()).isZero();
        var repeated=imports.commit(user,backup.id(),preview.sha256(),true);assertThat(repeated.imported()).isZero();assertThat(repeated.alreadyPresent()).isEqualTo(1);
        var reupload=backups.save(user,io.github.cgz4526.workout.backup.UploadIdentity.fromDigest(id().toString(),"Asia/Shanghai",validated.digest()),validated).backup();
        assertThat(imports.preview(user,reupload.id()).duplicateSessions()).isEqualTo(1);
        assertThat(service.list(user,20,null).items()).hasSize(1);
        assertThat(service.list(user,20,null).items().get(0).session().path("localDate").asString()).isEqualTo("2026-10-16");
        assertThat(backups.download(user,backup.id())).isEqualTo(bytes);
        assertThatThrownBy(()->imports.preview(account().id(),backup.id())).hasMessage("BACKUP_NOT_FOUND");
        var fractional=validator.validate(new ByteArrayInputStream(new String(bytes,StandardCharsets.UTF_8).replace("\"weight\":40", "\"weight\":40.0001").getBytes(StandardCharsets.UTF_8)));
        var unsupported=backups.save(user,io.github.cgz4526.workout.backup.UploadIdentity.fromDigest(id().toString(),"Asia/Shanghai",fractional.digest()),fractional).backup();
        assertThat(imports.preview(user,unsupported.id()).invalidSessions()).isEqualTo(1);
        assertThatThrownBy(()->imports.commit(user,unsupported.id(),unsupported.sha256(),true)).hasMessage("IMPORT_NEEDS_REVIEW");
    }
    HttpResponse<String> request(HttpClient c,String path,String method,String body,String csrf,String user) throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+path)).timeout(java.time.Duration.ofSeconds(15));
        if(csrf!=null)b.header("X-CSRF-TOKEN",csrf);if(user!=null)b.header("X-Expected-User",user);
        if(body!=null)b.header("Content-Type",path.equals("/auth/login")?"application/x-www-form-urlencoded":"application/json");
        return c.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    String csrf(HttpClient c) throws Exception { return json.readTree(request(c,"/auth/csrf","GET",null,null,null).body()).path("token").asString(); }
    @Test void httpUsesSessionCsrfExpectedAccountAndPersistentData() throws Exception {
        var user=account(); String ex=exercise(user.id());UUID s=id();
        var client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        assertThat(request(client,"/auth/login","POST","username="+user.username()+"&password="+PASSWORD,csrf(client),null).statusCode()).isEqualTo(200);
        String body=body(s,id(),ex,id(),id(),0,"COMPLETED");
        assertThat(request(client,"/workout-sessions","POST",body,null,user.id()).statusCode()).isEqualTo(403);
        assertThat(request(client,"/workout-sessions","POST",body,csrf(client),id().toString()).statusCode()).isEqualTo(409);
        var result=request(client,"/workout-sessions","POST",body,csrf(client),user.id());assertThat(result.statusCode()).withFailMessage(result.body()).isEqualTo(200);
        assertThat(request(client,"/workout-sessions/"+s,"GET",null,null,user.id()).statusCode()).isEqualTo(200);
        var other=account();var peer=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        assertThat(request(peer,"/auth/login","POST","username="+other.username()+"&password="+PASSWORD,csrf(peer),null).statusCode()).isEqualTo(200);
        assertThat(request(peer,"/workout-sessions/"+s,"GET",null,null,other.id()).statusCode()).isEqualTo(404);
        assertThat(request(peer,"/workout-sessions/"+s,"PUT",body(s,id(),ex,id(),id(),1,"COMPLETED"),csrf(peer),other.id()).statusCode()).isEqualTo(404);
        assertThat(request(peer,"/workout-sessions","POST",body(id(),id(),ex,id(),id(),0,"COMPLETED"),csrf(peer),other.id()).statusCode()).isEqualTo(422);
    }
}
