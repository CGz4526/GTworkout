package io.github.cgz4526.workout.backup;

import java.util.HashSet;
import java.util.Set;
import org.springframework.stereotype.Component;
import io.github.cgz4526.workout.shared.ApiFailure;

@Component
public class UploadGuard {
    private final Set<String> active = new HashSet<>();
    public synchronized void acquire(String userId) {
        if (active.size() >= 2 || !active.add(userId)) throw new ApiFailure(429, "UPLOAD_BUSY");
    }
    public synchronized void release(String userId) { active.remove(userId); }
}
