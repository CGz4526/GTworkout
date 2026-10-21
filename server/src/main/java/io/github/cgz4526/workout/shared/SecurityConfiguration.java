package io.github.cgz4526.workout.shared;

import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.core.userdetails.User;
import io.github.cgz4526.workout.identity.UserMapper;
import io.github.cgz4526.workout.identity.CredentialsPolicy;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import io.github.cgz4526.workout.backup.UploadGuard;

@Configuration
public class SecurityConfiguration {
    @Bean
    PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(10); }

    @Bean
    UserDetailsService users(UserMapper users) {
        return username -> {
            String normalized;
            try { normalized = CredentialsPolicy.normalizeUsername(username); }
            catch (IllegalArgumentException ex) { throw new UsernameNotFoundException("Invalid credentials"); }
            var account = users.findByUsername(normalized);
            if (account == null) throw new UsernameNotFoundException("Invalid credentials");
            return User.withUsername(account.username()).password(account.passwordHash()).roles("USER")
                    .disabled(!"ACTIVE".equals(account.status())).build();
        };
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, UploadGuard guard) throws Exception {
        return http.addFilterBefore(new AuthThrottleFilter(), UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(new UploadConcurrencyFilter(guard), AuthorizationFilter.class)
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/status", "/api/v1/system/status", "/api/v1/auth/csrf",
                        "/api/v1/auth/register", "/api/v1/auth/login", "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                .anyRequest().authenticated())
            .requestCache(cache -> cache.disable())
            .formLogin(form -> form.loginProcessingUrl("/api/v1/auth/login")
                .successHandler((req, res, auth) -> { res.setContentType("application/json"); res.getWriter().write("{\"authenticated\":true}"); })
                .failureHandler((req, res, ex) -> problem(req, res, 401, "INVALID_CREDENTIALS")))
            .logout(logout -> logout.logoutUrl("/api/v1/auth/logout").deleteCookies("SESSION")
                .logoutSuccessHandler((req, res, auth) -> res.setStatus(204)))
            .exceptionHandling(errors -> errors
                .authenticationEntryPoint((req, res, ex) -> problem(req, res, 401, "AUTHENTICATION_REQUIRED"))
                .accessDeniedHandler((req, res, ex) -> problem(req, res, 403, "ACCESS_DENIED")))
            .build();
    }

    static void problem(HttpServletRequest request, HttpServletResponse response, int status, String code)
            throws IOException {
        response.setStatus(status);
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/problem+json");
        response.getWriter().write("{\"type\":\"urn:workout:error:" + code
            + "\",\"title\":\"" + code + "\",\"status\":" + status
            + ",\"code\":\"" + code + "\",\"traceId\":\"" + request.getAttribute("traceId") + "\"}");
    }
}
