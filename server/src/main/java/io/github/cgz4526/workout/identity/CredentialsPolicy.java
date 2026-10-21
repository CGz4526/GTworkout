package io.github.cgz4526.workout.identity;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

/** Input policy only. Passwords are validated without normalization or storage. */
public final class CredentialsPolicy {
    private static final Pattern USERNAME = Pattern.compile("[a-z0-9_]{3,32}");

    private CredentialsPolicy() { }

    public static String normalizeUsername(String input) {
        if (input == null) throw new IllegalArgumentException("INVALID_USERNAME");
        String normalized = input.strip().toLowerCase(Locale.ROOT);
        if (!USERNAME.matcher(normalized).matches()) throw new IllegalArgumentException("INVALID_USERNAME");
        return normalized;
    }

    public static void validatePassword(String password) {
        if (password == null || password.length() > 72) throw invalidPassword();
        for (int i = 0; i < password.length(); i++) {
            char ch = password.charAt(i);
            if (ch == 0) throw invalidPassword();
            if (Character.isHighSurrogate(ch)) {
                if (++i >= password.length() || !Character.isLowSurrogate(password.charAt(i))) throw invalidPassword();
            } else if (Character.isLowSurrogate(ch)) {
                throw invalidPassword();
            }
        }
        if (password.codePointCount(0, password.length()) < 8
                || password.getBytes(StandardCharsets.UTF_8).length > 72) throw invalidPassword();
    }

    private static IllegalArgumentException invalidPassword() {
        return new IllegalArgumentException("INVALID_PASSWORD");
    }
}
