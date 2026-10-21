package io.github.cgz4526.workout.identity;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class CredentialsPolicyTest {
    @Test void canonicalUsernameMatchesDatabaseConstraint() {
        assertThat(CredentialsPolicy.normalizeUsername("  Alice_01  ")).isEqualTo("alice_01");
        for (String invalid : new String[]{"ab", "a".repeat(33), "用户123", "a.b", "alice\nsmith"}) {
            assertThatThrownBy(() -> CredentialsPolicy.normalizeUsername(invalid)).hasMessage("INVALID_USERNAME");
        }
    }

    @Test void bcryptBoundaryUsesUtf8BytesInsteadOfJavaLength() {
        assertThatCode(() -> CredentialsPolicy.validatePassword("密".repeat(24))).doesNotThrowAnyException();
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword("密".repeat(25))).hasMessage("INVALID_PASSWORD");
        assertThatCode(() -> CredentialsPolicy.validatePassword("a".repeat(72))).doesNotThrowAnyException();
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword("a".repeat(73))).hasMessage("INVALID_PASSWORD");
    }

    @Test void unicodeLengthCountsCodePointsAndRejectsBrokenEncoding() {
        assertThatCode(() -> CredentialsPolicy.validatePassword("😀".repeat(8))).doesNotThrowAnyException();
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword("😀".repeat(7))).hasMessage("INVALID_PASSWORD");
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword("password\uD800")).hasMessage("INVALID_PASSWORD");
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword("password\uDC00")).hasMessage("INVALID_PASSWORD");
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword("password\u0000")).hasMessage("INVALID_PASSWORD");
    }

    @Test void validationDoesNotTrimPasswordOrExposeItsValue() {
        assertThatCode(() -> CredentialsPolicy.validatePassword(" aaaaaa ")).doesNotThrowAnyException();
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword("secret")).hasMessage("INVALID_PASSWORD")
                .hasMessageNotContaining("secret");
        assertThatThrownBy(() -> CredentialsPolicy.validatePassword(null)).hasMessage("INVALID_PASSWORD");
    }
}
