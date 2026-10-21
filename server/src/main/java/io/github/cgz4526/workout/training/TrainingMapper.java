package io.github.cgz4526.workout.training;

import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface TrainingMapper {
  @Select(
      "SELECT source_exercise_id,max(exercise_name) exercise_name,max(body_part) body_part FROM"
          + " snapshot_session_exercise WHERE backup_id=CAST(#{backupId} AS uuid) GROUP BY"
          + " source_exercise_id ORDER BY source_exercise_id LIMIT 5001")
  List<TrainingViews.Exercise> exercises(String backupId);

  String FILTER =
      "s.backup_id=CAST(#{backupId} AS uuid) AND s.finished AND (CAST(#{from} AS date) IS NULL OR"
          + " s.local_date &gt;= CAST(#{from} AS date)) AND (CAST(#{to} AS date) IS NULL OR"
          + " s.local_date &lt;= CAST(#{to} AS date))";

  @Select(
      "<script>WITH filtered AS (SELECT * FROM snapshot_session s WHERE "
          + FILTER
          + "), totals AS (SELECT count(*) FILTER(WHERE kind!='REST')"
          + " training_sessions,count(DISTINCT local_date) FILTER(WHERE kind!='REST')"
          + " training_days,count(*) FILTER(WHERE kind='STRENGTH') strength_sessions,count(*)"
          + " FILTER(WHERE kind='AEROBIC') aerobic_sessions,count(DISTINCT local_date) FILTER(WHERE"
          + " kind='REST') rest_days,COALESCE(sum(distance) FILTER(WHERE kind='AEROBIC'),0)"
          + " aerobic_distance,COALESCE(sum(duration) FILTER(WHERE kind='AEROBIC'),0)"
          + " aerobic_duration FROM filtered), groups AS (SELECT count(*)"
          + " counted_sets,COALESCE(sum(COALESCE(g.weight,0)*COALESCE(g.reps,0)),0) volume FROM"
          + " snapshot_set g JOIN snapshot_session_exercise e ON g.exercise_id=e.id JOIN filtered f"
          + " ON e.session_id=f.id WHERE g.completed AND NOT g.warmup) SELECT"
          + " training_sessions,training_days,strength_sessions,aerobic_sessions,rest_days,counted_sets,volume,aerobic_distance,aerobic_duration"
          + " FROM totals CROSS JOIN groups</script>")
  TrainingViews.Summary summary(
      @Param("backupId") String backupId, @Param("from") LocalDate from, @Param("to") LocalDate to);

  @Select(
      "SELECT min(snapshot_date) data_from,max(snapshot_date) data_to FROM (SELECT local_date AS"
          + " snapshot_date FROM snapshot_session WHERE backup_id=CAST(#{backupId} AS uuid) UNION"
          + " ALL SELECT local_date FROM snapshot_weight WHERE backup_id=CAST(#{backupId} AS uuid))"
          + " dates")
  TrainingViews.Coverage coverage(String backupId);

  @Select(
      "<script>SELECT e.body_part,count(DISTINCT s.local_date) training_days FROM"
          + " snapshot_session_exercise e JOIN snapshot_session s ON e.session_id=s.id WHERE "
          + FILTER
          + " AND s.kind='STRENGTH' GROUP BY e.body_part ORDER BY e.body_part</script>")
  List<TrainingViews.BodyPart> bodyParts(
      @Param("backupId") String backupId, @Param("from") LocalDate from, @Param("to") LocalDate to);

  @Select(
      "<script>SELECT s.local_date,s.weight,s.source FROM snapshot_weight s WHERE"
          + " s.backup_id=CAST(#{backupId} AS uuid) AND (CAST(#{from} AS date) IS NULL OR"
          + " s.local_date &gt;= CAST(#{from} AS date)) AND (CAST(#{to} AS date) IS NULL OR"
          + " s.local_date &lt;= CAST(#{to} AS date)) ORDER BY s.local_date</script>")
  List<Projection.Weight> weights(
      @Param("backupId") String backupId, @Param("from") LocalDate from, @Param("to") LocalDate to);

  @Select(
      "<script>SELECT"
          + " s.source_id,s.local_date,s.kind,s.name,s.duration,s.distance,COALESCE(v.counted_sets,0)"
          + " counted_sets,COALESCE(v.volume,0) volume FROM snapshot_session s LEFT JOIN LATERAL"
          + " (SELECT count(*) counted_sets,sum(COALESCE(g.weight,0)*COALESCE(g.reps,0)) volume"
          + " FROM snapshot_session_exercise e JOIN snapshot_set g ON g.exercise_id=e.id WHERE"
          + " e.session_id=s.id AND g.completed AND NOT g.warmup) v ON true WHERE "
          + FILTER
          + " ORDER BY s.local_date DESC,s.id DESC LIMIT #{limit} OFFSET #{offset}</script>")
  List<TrainingViews.Session> sessions(
      @Param("backupId") String backupId,
      @Param("from") LocalDate from,
      @Param("to") LocalDate to,
      @Param("limit") int limit,
      @Param("offset") int offset);

  @Select(
      "<script>SELECT s.local_date,count(*)"
          + " counted_sets,COALESCE(sum(COALESCE(g.weight,0)*COALESCE(g.reps,0)),0)"
          + " volume,COALESCE(max(g.weight),0) max_weight FROM snapshot_session_exercise e JOIN"
          + " snapshot_session s ON e.session_id=s.id JOIN snapshot_set g ON g.exercise_id=e.id"
          + " WHERE "
          + FILTER
          + " AND e.source_exercise_id=#{sourceId} AND g.completed AND NOT g.warmup GROUP BY"
          + " s.local_date ORDER BY s.local_date LIMIT 501</script>")
  List<TrainingViews.Progress> progress(
      @Param("backupId") String backupId,
      @Param("sourceId") String sourceId,
      @Param("from") LocalDate from,
      @Param("to") LocalDate to);
}
