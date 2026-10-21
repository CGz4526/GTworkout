package io.github.cgz4526.workout.backup;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import io.github.cgz4526.workout.shared.ApiFailure;
import static org.assertj.core.api.Assertions.*;

class BackupValidatorTest {
    final BackupValidator validator = new BackupValidator();
    String base(String extra) {
        return "{\"version\":3,\"exercises\":[],\"templates\":[],\"sessions\":[],\"weights\":[]" + extra + "}";
    }
    BackupValidator.ValidatedBackup validate(String value) throws Exception {
        return validator.validate(new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)));
    }
    @Test void preservesUnknownFieldsAndRawWhitespace() throws Exception {
        String raw = "  " + base(",\"future\":{\"hello\":\"世界\"}") + "\n";
        assertThat(validate(raw).bytes()).isEqualTo(raw.getBytes(StandardCharsets.UTF_8));
    }
    @Test void oldVersionMayOmitWeightsAndNestedOptionalFields() throws Exception {
        assertThat(validate("{\"version\":1,\"exercises\":[],\"templates\":[],\"sessions\":[{\"id\":\"old\",\"date\":\"2026-10-16T00:00:00Z\"}]}").weightCount()).isZero();
    }
    @Test void rejectsDuplicateKeysTrailingDataBrokenUtf8AndUnknownVersion() {
        assertThatThrownBy(() -> validate(base(",\"version\":3"))).isInstanceOf(ApiFailure.class);
        assertThatThrownBy(() -> validate(base("") + "{}")).isInstanceOf(ApiFailure.class);
        assertThatThrownBy(() -> validator.validate(new ByteArrayInputStream(new byte[]{(byte) 0xc3, (byte) 0x28}))).isInstanceOf(ApiFailure.class);
        assertThatThrownBy(() -> validate(base("").replace("\"version\":3", "\"version\":4"))).hasMessage("UNSUPPORTED_BACKUP_VERSION");
    }
    @Test void rejectsDeepNestingAndLongNonPhotoStrings() {
        assertThatThrownBy(() -> validate(base(",\"nested\":" + "[".repeat(33) + "0" + "]".repeat(33)))).isInstanceOf(ApiFailure.class);
        assertThatThrownBy(() -> validate(base(",\"text\":\"" + "x".repeat(16385) + "\""))).isInstanceOf(ApiFailure.class);
    }
    @Test void photosHaveSeparateBudgetOnlyAtExpectedPath() throws Exception {
        String session = "[{\"id\":\"photo\",\"date\":\"2026-10-16T00:00:00Z\",\"notes\":\"\",\"photos\":[\"" + "x".repeat(20000) + "\"]}]";
        assertThat(validate(base("").replace("\"sessions\":[]", "\"sessions\":" + session)).sessionCount()).isEqualTo(1);
        assertThatThrownBy(() -> validate(base(",\"other\":{\"photos\":[\"" + "x".repeat(20000) + "\"]}"))).isInstanceOf(ApiFailure.class);
    }
    @Test void rejectsInvalidNumbersDatesAndDuplicateIdsWithoutNormalization() {
        String record = "{\"id\":\"s\",\"date\":\"2026-10-16T00:00:00Z\",\"exercises\":[{\"exerciseId\":\"missing-is-allowed\",\"sets\":[{\"weight\":-1,\"reps\":10}]}]}";
        assertThatThrownBy(() -> validate(base("").replace("\"sessions\":[]", "\"sessions\":[" + record + "]"))).isInstanceOf(ApiFailure.class);
        assertThatThrownBy(() -> validate(base("").replace("\"sessions\":[]", "\"sessions\":[" + record + "," + record + "]"))).isInstanceOf(ApiFailure.class);
        assertThatThrownBy(() -> validate(base("").replace("\"weights\":[]", "\"weights\":[{\"date\":\"2026-02-30\",\"weight\":70}]"))).isInstanceOf(ApiFailure.class);
    }
    @Test void fileHardLimitIsCheckedBeforeJsonParsing() {
        assertThatThrownBy(() -> validator.validate(new ByteArrayInputStream(new byte[BackupValidator.MAX_BYTES + 1])))
                .isInstanceOf(ApiFailure.class).hasMessage("BACKUP_TOO_LARGE");
    }

    @Test void tokenBudgetAndOverflowingVersionAreRejected() {
        assertThatThrownBy(() -> validate(base(",\"tokens\":[" + "0,".repeat(1000000) + "0]"))).isInstanceOf(ApiFailure.class);
        assertThatThrownBy(() -> validate(base("").replace("\"version\":3", "\"version\":4294967299"))).isInstanceOf(ApiFailure.class);
    }
}
