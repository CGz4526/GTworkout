package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.identity.IdentityService;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class AssistantController {
  private final AssistantService service;
  private final ExerciseCatalog catalog;
  private final IdentityService identity;

  public AssistantController(
      AssistantService service, ExerciseCatalog catalog, IdentityService identity) {
    this.service = service;
    this.catalog = catalog;
    this.identity = identity;
  }

  @GetMapping("/backups/{id}/available-exercises")
  public List<ExerciseCatalog.Exercise> exercises(Authentication auth, @PathVariable String id) {
    return catalog.list(identity.current(auth).id(), id);
  }

  @PostMapping("/assistant/runs")
  public ResponseEntity<Map<String, Object>> create(
      Authentication auth,
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody CoachRequest request) {
    var created = service.create(identity.current(auth).id(), key, request);
    return ResponseEntity.status(created.created() ? 202 : 200).body(created.run());
  }

  @GetMapping("/assistant/runs/{id}")
  public Map<String, Object> get(Authentication auth, @PathVariable String id) {
    return service.get(identity.current(auth).id(), id);
  }

  @GetMapping("/plan-drafts/{id}")
  public Map<String, Object> draft(Authentication auth, @PathVariable String id) {
    return service.draft(identity.current(auth).id(), id);
  }

  public record Confirm(int version) {}

  @PostMapping("/plan-drafts/{id}/confirm")
  public Map<String, Object> confirm(
      Authentication auth, @PathVariable String id, @RequestBody Confirm request) {
    return service.confirm(identity.current(auth).id(), id, request.version());
  }
}
