package io.github.cgz4526.workout.training;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface ProjectionMapper {
  @Select("SELECT set_config('statement_timeout','10s',true)")
  String setTimeout();

  @Insert(
      "<script>INSERT INTO"
          + " snapshot_session(id,backup_id,source_id,source_iso,started_at,local_date,kind,finished,name,duration,distance)"
          + " VALUES <foreach collection='rows' item='r' separator=','>(CAST(#{r.id} AS"
          + " uuid),CAST(#{backupId} AS"
          + " uuid),#{r.sourceId},#{r.sourceIso},#{r.startedAt},#{r.localDate},#{r.kind},#{r.finished},#{r.name},#{r.duration},#{r.distance})</foreach></script>")
  void sessions(@Param("backupId") String backupId, @Param("rows") List<Projection.Session> rows);

  @Insert(
      "<script>INSERT INTO"
          + " snapshot_session_exercise(id,backup_id,session_id,ordinal,source_exercise_id,exercise_name,body_part)"
          + " VALUES <foreach collection='rows' item='r' separator=','>(CAST(#{r.id} AS"
          + " uuid),CAST(#{backupId} AS uuid),CAST(#{r.sessionId} AS"
          + " uuid),#{r.ordinal},#{r.sourceExerciseId},#{r.exerciseName},#{r.bodyPart})</foreach></script>")
  void exercises(@Param("backupId") String backupId, @Param("rows") List<Projection.Exercise> rows);

  @Insert(
      "<script>INSERT INTO"
          + " snapshot_set(backup_id,exercise_id,ordinal,weight,reps,completed,warmup,rpe) VALUES"
          + " <foreach collection='rows' item='r' separator=','>(CAST(#{backupId} AS"
          + " uuid),CAST(#{r.exerciseId} AS"
          + " uuid),#{r.ordinal},#{r.weight},#{r.reps},#{r.completed},#{r.warmup},#{r.rpe})</foreach></script>")
  void groups(@Param("backupId") String backupId, @Param("rows") List<Projection.Group> rows);

  @Insert(
      "<script>INSERT INTO snapshot_weight(backup_id,local_date,weight,source) VALUES <foreach"
          + " collection='rows' item='r' separator=','>(CAST(#{backupId} AS"
          + " uuid),#{r.localDate},#{r.weight},#{r.source})</foreach></script>")
  void weights(@Param("backupId") String backupId, @Param("rows") List<Projection.Weight> rows);
}
