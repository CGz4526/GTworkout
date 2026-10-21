package io.github.cgz4526.workout.shared;

import java.io.IOException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import io.github.cgz4526.workout.backup.UploadGuard;

/** Runs after authorization but before DispatcherServlet multipart parsing. */
public class UploadConcurrencyFilter extends OncePerRequestFilter {
    private final UploadGuard guard;
    public UploadConcurrencyFilter(UploadGuard guard) { this.guard = guard; }
    @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        boolean upload = "POST".equals(req.getMethod()) && "/api/v1/backups".equals(req.getServletPath());
        boolean download = "GET".equals(req.getMethod()) && req.getServletPath().matches("/api/v1/backups/[^/]+/download");
        if (!upload && !download) {
            chain.doFilter(req, res); return;
        }
        String principal = SecurityContextHolder.getContext().getAuthentication().getName();
        try { guard.acquire(principal); }
        catch (ApiFailure ex) { SecurityConfiguration.problem(req, res, ex.status(), ex.code()); return; }
        try { chain.doFilter(req, res); } finally { guard.release(principal); }
    }
}
