package io.github.cgz4526.workout.backup;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.github.cgz4526.workout.identity.UserMapper;
import io.github.cgz4526.workout.shared.ApiFailure;
import io.github.cgz4526.workout.jobs.JobService;

@Service
public class BackupService {
    private final BackupMapper backups;
    private final UserMapper users;
    private final JobService jobs;
    private final int maxVersions;
    private final long maxBytes;
    public BackupService(BackupMapper backups, UserMapper users, JobService jobs,
            @Value("${workout.backup.max-versions:20}") int maxVersions,
            @Value("${workout.backup.max-total-bytes:209715200}") long maxBytes) {
        this.backups = backups; this.users = users; this.jobs=jobs; this.maxVersions = maxVersions; this.maxBytes = maxBytes;
    }

    @Transactional
    public UploadResult save(String userId, UploadIdentity identity, BackupValidator.ValidatedBackup data) {
        if (users.lockById(userId) == null) throw new ApiFailure(401, "AUTHENTICATION_REQUIRED");
        String existing = backups.findByKey(userId, identity.key().toString());
        if (existing != null) {
            if (!identity.fingerprint().equals(backups.fingerprint(userId, existing))) throw new ApiFailure(409, "IDEMPOTENCY_CONFLICT");
            return new UploadResult(backups.find(userId, existing), false);
        }
        if (backups.count(userId) >= maxVersions || backups.totalBytes(userId) + data.bytes().length > maxBytes) {
            throw new ApiFailure(429, "BACKUP_QUOTA_EXCEEDED");
        }
        String id = UUID.randomUUID().toString();
        backups.insert(id, userId, identity, data);
        jobs.enqueue(userId,id);
        backups.state(userId,id,"PROCESSING");
        return new UploadResult(backups.find(userId, id), true);
    }

    public BackupMetadata get(String userId, String id) {
        validateId(id);
        var result = backups.find(userId, id);
        if (result == null) throw new ApiFailure(404, "BACKUP_NOT_FOUND");
        return result;
    }
    public byte[] download(String userId, String id) {
        get(userId, id);
        return backups.download(userId, id).rawBytes();
    }
    @Transactional
    public BackupMetadata requestProjection(String userId,String id){
        users.lockById(userId);
        var backup=get(userId,id);
        if("NOT_REQUESTED".equals(backup.projectionStatus())) jobs.enqueue(userId,id);
        else if("FAILED".equals(backup.projectionStatus())) jobs.retry(userId,id);
        else throw new ApiFailure(409,"PROJECTION_NOT_RETRYABLE");
        backups.state(userId,id,"PROCESSING");
        return backups.find(userId,id);
    }
    public Page list(String userId, int limit, String cursor) {
        if (limit < 1 || limit > 50) throw new ApiFailure(422, "INVALID_PAGE_SIZE");
        OffsetDateTime before = null;
        String beforeId = null;
        if (cursor != null) {
            try {
                if (cursor.length() > 256) throw new IllegalArgumentException();
                String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\|", -1);
                if (parts.length != 2) throw new IllegalArgumentException();
                before = OffsetDateTime.parse(parts[0]); beforeId = UUID.fromString(parts[1]).toString();
            } catch (RuntimeException ex) { throw new ApiFailure(422, "INVALID_CURSOR"); }
        }
        var all = backups.list(userId, before, beforeId, limit + 1);
        List<BackupMetadata> items = all.subList(0, Math.min(limit, all.size()));
        String next = null;
        if (all.size() > limit) {
            var last = items.get(items.size() - 1);
            next = Base64.getUrlEncoder().withoutPadding().encodeToString((last.createdAt() + "|" + last.id()).getBytes(StandardCharsets.UTF_8));
        }
        return new Page(items, next);
    }
    private void validateId(String id) {
        try { if (!UUID.fromString(id).toString().equalsIgnoreCase(id)) throw new IllegalArgumentException(); }
        catch (RuntimeException ex) { throw new ApiFailure(404, "BACKUP_NOT_FOUND"); }
    }
    public record UploadResult(BackupMetadata backup, boolean created) { }
    public record Page(List<BackupMetadata> items, String nextCursor) { }
}
