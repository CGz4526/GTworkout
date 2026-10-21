package io.github.cgz4526.workout.jobs;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface JobMapper {
  record QueueState(long waiting, long running, double oldestSeconds) {}

  @Select(
      "SELECT count(*) FILTER(WHERE status IN ('PENDING','RETRY_WAIT')) waiting,count(*)"
          + " FILTER(WHERE status='RUNNING') running,COALESCE(EXTRACT(EPOCH FROM"
          + " (clock_timestamp()-min(created_at) FILTER(WHERE status IN"
          + " ('PENDING','RETRY_WAIT')))),0)::double precision oldest_seconds FROM background_job")
  QueueState queueState();

  String COLUMNS =
      "j.id::text,j.user_id::text,j.backup_id::text,j.type,j.status,j.attempts,j.manual_retries,j.next_run_at,j.execution_token::text,j.lease_until,j.deadline_at,j.error_code";

  @Insert(
      "INSERT INTO background_job(id,user_id,backup_id,type) VALUES(CAST(#{id} AS"
          + " uuid),CAST(#{userId} AS uuid),CAST(#{backupId} AS uuid),'BUILD_PROJECTION')")
  void insert(
      @Param("id") String id, @Param("userId") String userId, @Param("backupId") String backupId);

  @Select(
      "SELECT "
          + COLUMNS
          + " FROM background_job j WHERE j.id=CAST(#{id} AS uuid) AND j.user_id=CAST(#{userId} AS"
          + " uuid)")
  JobRecord get(@Param("userId") String userId, @Param("id") String id);

  @Select(
      "SELECT "
          + COLUMNS
          + " FROM background_job j WHERE j.backup_id=CAST(#{backupId} AS uuid) AND"
          + " j.user_id=CAST(#{userId} AS uuid)")
  JobRecord forBackup(@Param("userId") String userId, @Param("backupId") String backupId);

  @Select(
      value =
          "WITH candidate AS (SELECT id FROM background_job WHERE status IN"
              + " ('PENDING','RETRY_WAIT') AND next_run_at<=clock_timestamp() AND attempts<3 ORDER"
              + " BY next_run_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE background_job j"
              + " SET status='RUNNING',attempts=j.attempts+1,execution_token=CAST(#{token} AS"
              + " uuid),lease_until=clock_timestamp()+make_interval(secs=>#{lease}),deadline_at=clock_timestamp()+make_interval(secs=>#{deadline}),updated_at=clock_timestamp(),error_code=NULL"
              + " FROM candidate c WHERE j.id=c.id RETURNING "
              + COLUMNS,
      affectData = true)
  JobRecord claim(
      @Param("token") String token, @Param("lease") int lease, @Param("deadline") int deadline);

  @Update(
      "UPDATE background_job SET"
          + " lease_until=LEAST(clock_timestamp()+make_interval(secs=>#{lease}),deadline_at),updated_at=clock_timestamp()"
          + " WHERE id=CAST(#{job.id} AS uuid) AND status='RUNNING' AND"
          + " execution_token=CAST(#{job.executionToken} AS uuid) AND lease_until>clock_timestamp()"
          + " AND deadline_at>clock_timestamp()")
  int renew(@Param("job") JobRecord job, @Param("lease") int lease);

  @Select(
      "SELECT count(*) FROM background_job WHERE id=CAST(#{id} AS uuid) AND status='RUNNING' AND"
          + " execution_token=CAST(#{executionToken} AS uuid) AND lease_until>clock_timestamp() AND"
          + " deadline_at>clock_timestamp()")
  int owned(JobRecord job);

  @Update(
      "UPDATE background_job SET"
          + " status='SUCCEEDED',execution_token=NULL,lease_until=NULL,deadline_at=NULL,error_code=NULL,updated_at=clock_timestamp()"
          + " WHERE id=CAST(#{id} AS uuid) AND status='RUNNING' AND"
          + " execution_token=CAST(#{executionToken} AS uuid) AND lease_until>clock_timestamp() AND"
          + " deadline_at>clock_timestamp()")
  int complete(JobRecord job);

  @Select(
      value =
          "UPDATE background_job j SET status=CASE WHEN #{permanent} OR attempts>=3 THEN 'FAILED'"
              + " ELSE 'RETRY_WAIT'"
              + " END,next_run_at=clock_timestamp()+make_interval(secs=>attempts*attempts*2),execution_token=NULL,lease_until=NULL,deadline_at=NULL,error_code=#{code},updated_at=clock_timestamp()"
              + " WHERE id=CAST(#{job.id} AS uuid) AND status='RUNNING' AND"
              + " execution_token=CAST(#{job.executionToken} AS uuid) AND"
              + " lease_until>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING "
              + COLUMNS,
      affectData = true)
  JobRecord fail(
      @Param("job") JobRecord job,
      @Param("code") String code,
      @Param("permanent") boolean permanent);

  @Select(
      value =
          "UPDATE background_job j SET status=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'RETRY_WAIT'"
              + " END,next_run_at=clock_timestamp()+make_interval(secs=>attempts*attempts*2),execution_token=NULL,lease_until=NULL,deadline_at=NULL,error_code='LEASE_EXPIRED',updated_at=clock_timestamp()"
              + " WHERE status='RUNNING' AND lease_until<=clock_timestamp() RETURNING "
              + COLUMNS,
      affectData = true)
  List<JobRecord> recoverExpired();

  @Update(
      "UPDATE background_job SET"
          + " status='PENDING',attempts=0,manual_retries=manual_retries+1,next_run_at=clock_timestamp(),error_code=NULL,updated_at=clock_timestamp()"
          + " WHERE id=CAST(#{id} AS uuid) AND status='FAILED' AND manual_retries<3")
  int retry(String id);
}
