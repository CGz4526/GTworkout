package io.github.cgz4526.workout.identity;

import org.apache.ibatis.annotations.*;

@Mapper
public interface UserMapper {
    @Select("SELECT id::text, normalized_username AS username, password_hash, status, created_at FROM app_user WHERE normalized_username=#{username}")
    UserAccount findByUsername(String username);

    @Select("SELECT id::text, normalized_username AS username, password_hash, status, created_at FROM app_user WHERE id=CAST(#{id} AS uuid) FOR UPDATE")
    UserAccount lockById(String id);

    @Insert("INSERT INTO app_user(id, normalized_username, password_hash) VALUES(CAST(#{id} AS uuid),#{username},#{passwordHash})")
    void insert(@Param("id") String id, @Param("username") String username, @Param("passwordHash") String passwordHash);

    @Select("SELECT count(*) FROM app_user") long count();
    @Select("SELECT 1 FROM pg_advisory_xact_lock(816521001)") int lockRegistration();
}
