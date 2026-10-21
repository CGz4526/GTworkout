package io.github.cgz4526.workout.identity;

import java.time.OffsetDateTime;
import com.fasterxml.jackson.annotation.JsonIgnore;

public record UserAccount(String id, String username, @JsonIgnore String passwordHash,
                          String status, OffsetDateTime createdAt) {
    public PublicUser publicUser() { return new PublicUser(id, username); }
    public record PublicUser(String id, String username) { }
    @Override public String toString() { return "UserAccount[id=" + id + "]"; }
}
