package io.github.cgz4526.workout.backup;

import java.io.IOException;
import java.net.URI;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import io.github.cgz4526.workout.identity.IdentityService;

@RestController
@RequestMapping("/api/v1/backups")
public class BackupController {
    private final IdentityService identity;
    private final BackupService backups;
    private final BackupValidator validator;
    public BackupController(IdentityService identity, BackupService backups, BackupValidator validator) {
        this.identity = identity; this.backups = backups; this.validator = validator;
    }
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<BackupMetadata> upload(Authentication auth, @RequestHeader("Idempotency-Key") String key,
            @RequestHeader("X-Expected-User") String expectedUser,
            @RequestParam("timezone") String timezone, @RequestParam("file") MultipartFile file) throws IOException {
        String userId = identity.current(auth).id();
        if (!userId.equals(expectedUser)) throw new io.github.cgz4526.workout.shared.ApiFailure(409, "ACCOUNT_CHANGED");
        try (var input = file.getInputStream()) {
            var data = validator.validate(input);
            var uploadIdentity = UploadIdentity.fromDigest(key, timezone, data.digest());
            var result = backups.save(userId, uploadIdentity, data);
            return ResponseEntity.status(result.created() ? 202 : 200)
                    .location(URI.create("/api/v1/backups/" + result.backup().id())).body(result.backup());
        }
    }
    @GetMapping public BackupService.Page list(Authentication auth, @RequestParam(defaultValue="20") int limit,
            @RequestParam(required=false) String cursor) { return backups.list(identity.current(auth).id(), limit, cursor); }
    @PostMapping("/{id}/retry") public ResponseEntity<BackupMetadata> retry(Authentication auth,@PathVariable String id){
        return ResponseEntity.accepted().body(backups.requestProjection(identity.current(auth).id(),id));
    }
    @GetMapping("/{id}") public BackupMetadata get(Authentication auth, @PathVariable String id) {
        return backups.get(identity.current(auth).id(), id);
    }
    @GetMapping("/{id}/download") public ResponseEntity<byte[]> download(Authentication auth, @PathVariable String id) {
        byte[] content = backups.download(identity.current(auth).id(), id);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename("workout-backup-" + id + ".json").build().toString())
                .header("X-Content-Type-Options", "nosniff").body(content);
    }
}
