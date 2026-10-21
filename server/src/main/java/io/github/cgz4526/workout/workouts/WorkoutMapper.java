package io.github.cgz4526.workout.workouts;

import java.time.OffsetDateTime;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface WorkoutMapper {
    record SessionRow(String document, long version, String editorDeviceId, String updatedAt, String type, String status) {}
    record MutationRow(String requestSha256, String resourceType, String resourceId, String responseJson) {}
    record ExerciseRow(String id, String name, String bodyPart, int restSeconds) {}

    @Select("SELECT id::text FROM app_user WHERE id=CAST(#{user} AS uuid) FOR UPDATE")
    String lockUser(String user);
    @Select("SELECT request_sha256,resource_type,resource_id::text,response_json::text FROM training_mutation WHERE user_id=CAST(#{user} AS uuid) AND mutation_id=CAST(#{mutation} AS uuid)")
    MutationRow mutation(@Param("user") String user, @Param("mutation") String mutation);
    @Select("SELECT count(*) FROM training_mutation WHERE user_id=CAST(#{user} AS uuid)")
    long mutations(String user);
    @Insert("INSERT INTO training_mutation(user_id,mutation_id,request_sha256,resource_type,resource_id,response_status,response_json) VALUES(CAST(#{user} AS uuid),CAST(#{mutation} AS uuid),#{sha},#{kind},CAST(#{resource} AS uuid),200,CAST(#{response} AS jsonb))")
    void remember(@Param("user") String user,@Param("mutation") String mutation,@Param("sha") String sha,@Param("kind") String kind,@Param("resource") String resource,@Param("response") String response);
    @Select("SELECT document::text,version,editor_device_id::text,updated_at::text,type,status FROM live_session WHERE user_id=CAST(#{user} AS uuid) AND id=CAST(#{id} AS uuid)")
    SessionRow find(@Param("user") String user,@Param("id") String id);
    @Select("SELECT id::text FROM live_session WHERE user_id=CAST(#{user} AS uuid) AND status='ACTIVE'")
    String active(String user);
    @Select("SELECT count(*) FROM live_session WHERE user_id=CAST(#{user} AS uuid)")
    long sessionCount(String user);
    @Select("<script>SELECT document::text,version,editor_device_id::text,updated_at::text,type,status FROM live_session WHERE user_id=CAST(#{user} AS uuid) AND status&lt;&gt;'CANCELLED' AND created_at&lt;=#{cutoff}<if test='before != null'> AND (occurred_at,id)&lt;(#{before},CAST(#{beforeId} AS uuid))</if> ORDER BY occurred_at DESC,id DESC LIMIT #{limit}</script>")
    List<SessionRow> list(@Param("user") String user,@Param("cutoff") OffsetDateTime cutoff,@Param("before") OffsetDateTime before,@Param("beforeId") String beforeId,@Param("limit") int limit);
    @Insert("""
        INSERT INTO live_session(user_id,id,type,status,occurred_at,local_date,utc_offset_minutes,started_at,finished_at,duration_seconds,template_name,notes,diet,distance_km,editor_device_id,version,document)
        VALUES(CAST(#{user} AS uuid),CAST(#{id} AS uuid),#{type},#{status},CAST(#{occurred} AS timestamptz),CAST(#{day} AS date),#{offset},CAST(#{start} AS timestamptz),CAST(#{finish} AS timestamptz),#{duration},#{name},#{notes},#{diet},CAST(#{distance} AS numeric),CAST(#{device} AS uuid),1,CAST(#{document} AS jsonb))
        """)
    void insert(SessionWrite data);
    @Update("""
        UPDATE live_session SET type=#{type},status=#{status},occurred_at=CAST(#{occurred} AS timestamptz),local_date=CAST(#{day} AS date),utc_offset_minutes=#{offset},started_at=CAST(#{start} AS timestamptz),finished_at=CAST(#{finish} AS timestamptz),duration_seconds=#{duration},template_name=#{name},notes=#{notes},diet=#{diet},distance_km=CAST(#{distance} AS numeric),version=version+1,document=CAST(#{document} AS jsonb),updated_at=clock_timestamp()
        WHERE user_id=CAST(#{user} AS uuid) AND id=CAST(#{id} AS uuid)
        """)
    void update(SessionWrite data);
    record SessionWrite(String user,String id,String type,String status,String occurred,String day,int offset,String start,String finish,int duration,String name,String notes,String diet,String distance,String device,String document) {}
    @Select("SELECT session_id::text FROM live_session_exercise WHERE user_id=CAST(#{user} AS uuid) AND id=CAST(#{id} AS uuid)")
    String exerciseParent(@Param("user") String user,@Param("id") String id);
    @Select("SELECT session_id::text FROM live_set WHERE user_id=CAST(#{user} AS uuid) AND id=CAST(#{id} AS uuid)")
    String setParent(@Param("user") String user,@Param("id") String id);
    @Delete("DELETE FROM live_set WHERE user_id=CAST(#{user} AS uuid) AND session_id=CAST(#{id} AS uuid)")
    void replaceSets(@Param("user") String user,@Param("id") String id);
    @Delete("DELETE FROM live_session_exercise WHERE user_id=CAST(#{user} AS uuid) AND session_id=CAST(#{id} AS uuid)")
    void replaceExercises(@Param("user") String user,@Param("id") String id);
    @Insert("INSERT INTO live_session_exercise(user_id,session_id,id,exercise_id,exercise_name,rest_seconds,position) VALUES(CAST(#{user} AS uuid),CAST(#{session} AS uuid),CAST(#{id} AS uuid),CAST(#{exercise} AS uuid),#{name},#{rest},#{position})")
    void addExercise(@Param("user") String user,@Param("session") String session,@Param("id") String id,@Param("exercise") String exercise,@Param("name") String name,@Param("rest") int rest,@Param("position") int position);
    @Insert("INSERT INTO live_set(user_id,session_id,session_exercise_id,id,position,weight_kg,reps,completed,warmup,rpe) VALUES(CAST(#{user} AS uuid),CAST(#{session} AS uuid),CAST(#{exercise} AS uuid),CAST(#{id} AS uuid),#{position},CAST(#{weight} AS numeric),CAST(#{reps} AS integer),#{completed},#{warmup},CAST(#{rpe} AS numeric))")
    void addSet(@Param("user") String user,@Param("session") String session,@Param("exercise") String exercise,@Param("id") String id,@Param("position") int position,@Param("weight") String weight,@Param("reps") String reps,@Param("completed") boolean completed,@Param("warmup") boolean warmup,@Param("rpe") String rpe);
    @Select("SELECT id::text,name,body_part,rest_seconds FROM live_exercise WHERE user_id=CAST(#{user} AS uuid) AND id=CAST(#{id} AS uuid)")
    ExerciseRow exercise(@Param("user") String user,@Param("id") String id);
    @Select("<script>SELECT id::text,name,body_part,rest_seconds FROM live_exercise WHERE user_id=CAST(#{user} AS uuid)<if test='before != null'> AND id&gt;CAST(#{before} AS uuid)</if> ORDER BY id LIMIT #{limit}</script>")
    List<ExerciseRow> exercises(@Param("user") String user,@Param("before") String before,@Param("limit") int limit);
    @Insert("INSERT INTO live_exercise(user_id,id,name,body_part,rest_seconds) VALUES(CAST(#{user} AS uuid),CAST(#{row.id} AS uuid),#{row.name},#{row.bodyPart},#{row.restSeconds})")
    void insertExercise(@Param("user") String user,@Param("row") ExerciseRow row);
}
