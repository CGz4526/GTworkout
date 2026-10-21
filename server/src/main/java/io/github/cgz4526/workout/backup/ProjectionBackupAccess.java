package io.github.cgz4526.workout.backup;

import org.springframework.stereotype.Service;
import io.github.cgz4526.workout.shared.ApiFailure;

@Service
public class ProjectionBackupAccess {
    private final BackupMapper backups;
    public ProjectionBackupAccess(BackupMapper backups){this.backups=backups;}
    public BackupMetadata metadata(String userId,String id){
        var backup=backups.find(userId,id);
        if(backup==null)throw new ApiFailure(404,"BACKUP_NOT_FOUND");
        return backup;
    }
    public byte[] raw(String userId,String id){return backups.download(userId,id).rawBytes();}
    public void state(String userId,String id,String status){
        if(backups.state(userId,id,status)!=1)throw new ApiFailure(404,"BACKUP_NOT_FOUND");
    }
}
