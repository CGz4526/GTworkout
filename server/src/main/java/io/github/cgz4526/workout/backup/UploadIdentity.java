package io.github.cgz4526.workout.backup;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Stable fingerprint of one upload intent. Contains no raw backup bytes. */
public record UploadIdentity(UUID key, String timezone, String sha256, String fingerprint) {
    private static final Set<String> ZONES = ZoneId.getAvailableZoneIds();
    private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    public static UploadIdentity fromDigest(String key, String timezone, byte[] rawSha256) {
        if (key == null || !UUID_TEXT.matcher(key).matches()) throw new IllegalArgumentException("INVALID_IDEMPOTENCY_KEY");
        if (timezone == null || timezone.length() > 64 || !ZONES.contains(timezone)) {
            throw new IllegalArgumentException("INVALID_TIMEZONE");
        }
        if (rawSha256 == null || rawSha256.length != 32) throw new IllegalArgumentException("INVALID_SHA256");
        String digest = HexFormat.of().formatHex(rawSha256);
        try {
            String fingerprint = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(("1\n" + digest + "\n" + timezone).getBytes(StandardCharsets.UTF_8)));
            return new UploadIdentity(UUID.fromString(key), timezone, digest, fingerprint);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }
}
