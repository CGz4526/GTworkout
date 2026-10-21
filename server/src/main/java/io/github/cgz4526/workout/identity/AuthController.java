package io.github.cgz4526.workout.identity;

import java.util.Map;
import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import tools.jackson.databind.json.JsonMapper;
import io.github.cgz4526.workout.shared.ApiFailure;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final IdentityService identity;
    private final JsonMapper json;
    public AuthController(IdentityService identity, JsonMapper json) { this.identity = identity; this.json = json; }
    @GetMapping("/csrf") public Map<String, String> csrf(CsrfToken csrf) {
        return Map.of("token", csrf.getToken(), "headerName", csrf.getHeaderName());
    }
    @PostMapping("/register") @ResponseStatus(HttpStatus.CREATED)
    public UserAccount.PublicUser register(HttpServletRequest servletRequest) throws IOException {
        byte[] bytes = servletRequest.getInputStream().readNBytes(4097);
        if (bytes.length > 4096) throw new ApiFailure(413, "REGISTRATION_TOO_LARGE");
        Registration request;
        try { request = json.readValue(bytes, Registration.class); }
        catch (Exception ex) { throw new ApiFailure(422, "INVALID_REGISTRATION"); }
        if (request == null) throw new ApiFailure(422, "INVALID_REGISTRATION");
        return identity.register(request.username(), request.password());
    }
    @GetMapping("/me") public UserAccount.PublicUser me(Authentication auth) {
        return identity.current(auth).publicUser();
    }
    public record Registration(String username, String password) {
        @Override public String toString() { return "Registration[redacted]"; }
    }
}
