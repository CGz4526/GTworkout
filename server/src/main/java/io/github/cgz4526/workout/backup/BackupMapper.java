package io.github.cgz4526.workout.backup;

import java.time.OffsetDateTime;
import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface BackupMapper {
    String COLUMNS = "id::text, created_at, size_bytes, sha256, format_version, timezone, exercise_count, template_count, session_count, weight_count, projection_status, (SELECT j.id::text FROM background_job j WHERE j.backup_id=backup_snapshot.id) AS job_id";

    @Select("SELECT " + COLUMNS + " FROM backup_snapshot WHERE user_id=CAST(#{userId} AS uuid) AND id=CAST(#{id} AS uuid)")
    BackupMetadata find(@Param("userId") String userId, @Param("id") String id);
    @Select("SELECT id::text FROM backup_snapshot WHERE user_id=CAST(#{userId} AS uuid) AND idempotency_key=CAST(#{key} AS uuid)")
    String findByKey(@Param("userId") String userId, @Param("key") String key);
    @Select("SELECT request_fingerprint FROM backup_snapshot WHERE user_id=CAST(#{userId} AS uuid) AND id=CAST(#{id} AS uuid)")
    String fingerprint(@Param("userId") String userId, @Param("id") String id);
    @Select("SELECT raw_bytes FROM backup_snapshot WHERE user_id=CAST(#{userId} AS uuid) AND id=CAST(#{id} AS uuid)")
    RawBackup download(@Param("userId") String userId, @Param("id") String id);
    record RawBackup(byte[] rawBytes) {
        @Override public String toString() { return "RawBackup[redacted]"; }
    }
    @Select("SELECT count(*) FROM backup_snapshot WHERE user_id=CAST(#{userId} AS uuid)")
    long count(String userId);
    @Select("SELECT COALESCE(sum(size_bytes),0) FROM backup_snapshot WHERE user_id=CAST(#{userId} AS uuid)")
    long totalBytes(String userId);
    @Update("UPDATE backup_snapshot SET projection_status=#{status} WHERE id=CAST(#{id} AS uuid) AND user_id=CAST(#{userId} AS uuid)")
    int state(@Param("userId") String userId,@Param("id") String id,@Param("status") String status);
    @Select("<script>SELECT " + COLUMNS + " FROM backup_snapshot WHERE user_id=CAST(#{userId} AS uuid)"
            + "<if test='before != null'> AND (created_at,id) &lt; (#{before},CAST(#{beforeId} AS uuid))</if>"
            + " ORDER BY created_at DESC, id DESC LIMIT #{limit}</script>")
    List<BackupMetadata> list(@Param("userId") String userId, @Param("before") OffsetDateTime before,
            @Param("beforeId") String beforeId, @Param("limit") int limit);

    @Insert("INSERT INTO backup_snapshot(id,user_id,idempotency_key,request_fingerprint,sha256,size_bytes,format_version,contract_version,timezone,raw_bytes,exercise_count,template_count,session_count,weight_count) "
            + "VALUES(CAST(#{id} AS uuid),CAST(#{userId} AS uuid),CAST(#{identity.key} AS uuid),#{identity.fingerprint},#{identity.sha256},octet_length(#{data.bytes}),#{data.version},1,#{identity.timezone},#{data.bytes},#{data.exerciseCount},#{data.templateCount},#{data.sessionCount},#{data.weightCount})")
    void insert(@Param("id") String id, @Param("userId") String userId, @Param("identity") UploadIdentity identity,
            @Param("data") BackupValidator.ValidatedBackup data);
}
