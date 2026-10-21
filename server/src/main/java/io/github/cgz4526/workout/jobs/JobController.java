package io.github.cgz4526.workout.jobs;

import io.github.cgz4526.workout.identity.IdentityService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class JobController {
  private final IdentityService identity;
  private final JobService jobs;

  public JobController(IdentityService identity, JobService jobs) {
    this.identity = identity;
    this.jobs = jobs;
  }

  @GetMapping("/api/v1/jobs/{id}")
  public JobRecord.PublicJob get(Authentication auth, @PathVariable String id) {
    return jobs.get(identity.current(auth).id(), id);
  }
}
