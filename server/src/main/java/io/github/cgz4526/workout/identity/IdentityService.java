package io.github.cgz4526.workout.identity;

import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.github.cgz4526.workout.shared.ApiFailure;

@Service
public class IdentityService {
    private final UserMapper users;
    private final PasswordEncoder passwords;
    private final boolean registrationEnabled;
    private final int maxUsers;
    public IdentityService(UserMapper users, PasswordEncoder passwords,
            @Value("${workout.registration-enabled:false}") boolean registrationEnabled,
            @Value("${workout.max-users:10}") int maxUsers) {
        this.users = users; this.passwords = passwords;
        this.registrationEnabled = registrationEnabled; this.maxUsers = maxUsers;
    }

    @Transactional
    public UserAccount.PublicUser register(String username, String password) {
        if (!registrationEnabled) throw new ApiFailure(403, "REGISTRATION_DISABLED");
        String normalized = CredentialsPolicy.normalizeUsername(username);
        CredentialsPolicy.validatePassword(password);
        // Hash outside the registration lock; no raw password is persisted or logged.
        String hash = passwords.encode(password);
        users.lockRegistration();
        if (users.findByUsername(normalized) != null) throw new ApiFailure(409, "USERNAME_UNAVAILABLE");
        if (users.count() >= maxUsers) throw new ApiFailure(429, "ACCOUNT_QUOTA_EXCEEDED");
        String id = UUID.randomUUID().toString();
        try { users.insert(id, normalized, hash); }
        catch (DuplicateKeyException ex) { throw new ApiFailure(409, "USERNAME_UNAVAILABLE"); }
        return new UserAccount.PublicUser(id, normalized);
    }

    public UserAccount current(Authentication authentication) {
        if (authentication == null) throw new ApiFailure(401, "AUTHENTICATION_REQUIRED");
        UserAccount user = users.findByUsername(authentication.getName());
        if (user == null || !"ACTIVE".equals(user.status())) throw new ApiFailure(401, "AUTHENTICATION_REQUIRED");
        return user;
    }
}
