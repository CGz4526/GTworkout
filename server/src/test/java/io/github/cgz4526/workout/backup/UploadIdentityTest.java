package io.github.cgz4526.workout.backup;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class UploadIdentityTest {
    static final String KEY = "01234567-89ab-cdef-0123-456789abcdef";

    byte[] digest(String content) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8));
    }

    @Test void sameIntentHasStableFingerprintRegardlessOfUuidCase() throws Exception {
        byte[] digest = digest("{\"version\":3}");
        var first = UploadIdentity.fromDigest(KEY, "Asia/Shanghai", digest);
        assertThat(UploadIdentity.fromDigest(KEY.toUpperCase(), "Asia/Shanghai", digest)).isEqualTo(first);
        assertThat(first.sha256()).isEqualTo(HexFormat.of().formatHex(digest));
        // Fingerprints deliberately exclude the key: distinct upload intents remain separate versions.
        assertThat(UploadIdentity.fromDigest("11234567-89ab-cdef-0123-456789abcdef", "Asia/Shanghai", digest).fingerprint())
                .isEqualTo(first.fingerprint());
    }

    @Test void byteOrTimezoneChangesProduceConflictFingerprint() throws Exception {
        var first = UploadIdentity.fromDigest(KEY, "Asia/Shanghai", digest("{}"));
        assertThat(UploadIdentity.fromDigest(KEY, "Asia/Shanghai", digest("{} ")).fingerprint()).isNotEqualTo(first.fingerprint());
        assertThat(UploadIdentity.fromDigest(KEY, "UTC", digest("{}")).fingerprint()).isNotEqualTo(first.fingerprint());
    }

    @Test void rejectsUuidAbbreviationAndOffsetTimezoneBeforeDatabaseAccess() {
        assertThatThrownBy(() -> UploadIdentity.fromDigest("1-1-1-1-1", "UTC", new byte[32])).hasMessage("INVALID_IDEMPOTENCY_KEY");
        assertThatThrownBy(() -> UploadIdentity.fromDigest(KEY, "+08:00", new byte[32])).hasMessage("INVALID_TIMEZONE");
        assertThatThrownBy(() -> UploadIdentity.fromDigest(KEY, "Asia/Shanghai", new byte[31])).hasMessage("INVALID_SHA256");
    }
}
