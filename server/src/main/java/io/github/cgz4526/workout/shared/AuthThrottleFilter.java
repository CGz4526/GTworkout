package io.github.cgz4526.workout.shared;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import io.github.cgz4526.workout.identity.CredentialsPolicy;

/** Bounded, single-process fixed-window limiter; never trusts forwarded IP headers. */
public class AuthThrottleFilter extends OncePerRequestFilter {
    private record Window(long until, int count) { }
    private final Map<String, Window> windows = new HashMap<>();
    private synchronized boolean allow(String key, int limit) {
        long now = System.currentTimeMillis();
        windows.entrySet().removeIf(entry -> entry.getValue().until() <= now);
        Window window = windows.get(key);
        if (window == null) {
            if (windows.size() >= 4096) return false;
            windows.put(key, new Window(now + 600_000, 1)); return true;
        }
        if (window.count() >= limit) return false;
        windows.put(key, new Window(window.until(), window.count() + 1)); return true;
    }
    @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        String path = req.getServletPath();
        if (!"POST".equals(req.getMethod()) || !(path.equals("/api/v1/auth/login") || path.equals("/api/v1/auth/register"))) {
            chain.doFilter(req, res); return;
        }
        if (req.getContentLengthLong() > 4096) { SecurityConfiguration.problem(req, res, 413, "AUTH_REQUEST_TOO_LARGE"); return; }
        if (!allow(path + ":" + req.getRemoteAddr(), path.endsWith("register") ? 5 : 30)) {
            res.setHeader("Retry-After", "600"); SecurityConfiguration.problem(req, res, 429, "AUTH_RATE_LIMITED"); return;
        }
        if (path.endsWith("login")) {
            String username;
            try {
                username = CredentialsPolicy.normalizeUsername(req.getParameter("username"));
                CredentialsPolicy.validatePassword(req.getParameter("password"));
            } catch (IllegalArgumentException ex) { SecurityConfiguration.problem(req, res, 401, "INVALID_CREDENTIALS"); return; }
            if (!allow("account:" + username, 10)) {
                res.setHeader("Retry-After", "600"); SecurityConfiguration.problem(req, res, 429, "AUTH_RATE_LIMITED"); return;
            }
        }
        chain.doFilter(req, res);
    }
}
