package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.identity.UserMapper;
import io.github.cgz4526.workout.shared.ApiFailure;
import io.github.cgz4526.workout.training.TrainingService;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AssistantService {
  private final AssistantStore store;
  private final ModelGateway model;
  private final UserMapper users;
  private final ExerciseCatalog catalog;
  private final TrainingService training;

  public AssistantService(
      AssistantStore store,
      ModelGateway model,
      UserMapper users,
      ExerciseCatalog catalog,
      TrainingService training) {
    this.store = store;
    this.model = model;
    this.users = users;
    this.catalog = catalog;
    this.training = training;
  }

  public record Created(Map<String, Object> run, boolean created) {}

  @Transactional
  public Created create(String user, String key, CoachRequest request) {
    uuid(key);
    request.validate();
    if (!model.configured()) throw new ApiFailure(503, "ASSISTANT_NOT_CONFIGURED");
    users.lockById(user);
    String fingerprint;
    try {
      fingerprint =
          HexFormat.of()
              .formatHex(
                  MessageDigest.getInstance("SHA-256")
                      .digest(AssistantJson.JSON.writeValueAsBytes(request)));
    } catch (Exception ex) {
      throw new IllegalStateException();
    }
    var existing = store.replay(user, key);
    if (existing != null) {
      if (!existing.fingerprint().equals(fingerprint))
        throw new ApiFailure(409, "IDEMPOTENCY_CONFLICT");
      return new Created(view(existing), false);
    }
    if (store.quota(user)) throw new ApiFailure(429, "AGENT_QUOTA_EXCEEDED");
    // Authorize READY and selected exercises before a task can incur cost.
    new CoachTools(user, request, training, catalog.list(user, request.backupId()));
    String id = UUID.randomUUID().toString();
    store.insert(id, user, key, request, fingerprint, model.model());
    return new Created(view(store.get(user, id)), true);
  }

  public Map<String, Object> get(String user, String id) {
    uuid(id);
    var run = store.get(user, id);
    if (run == null) throw new ApiFailure(404, "AGENT_RUN_NOT_FOUND");
    return view(run);
  }

  private Map<String, Object> view(AssistantStore.Run run) {
    var result = new LinkedHashMap<String, Object>();
    result.put("id", run.id());
    result.put("backupId", run.backupId());
    result.put("status", run.status());
    result.put("errorCode", run.errorCode());
    result.put("model", run.model());
    result.put("promptVersion", "coach-v1");
    result.put(
        "usage", new CoachEngine.Usage(run.modelCalls(), run.toolCalls(), run.totalTokens()));
    result.put("result", run.resultJson() == null ? null : AssistantJson.parse(run.resultJson()));
    return result;
  }

  public Map<String, Object> draft(String user, String id) {
    return draftView(requireDraft(user, id, false));
  }

  private AssistantStore.Draft requireDraft(String user, String id, boolean lock) {
    uuid(id);
    var draft = store.draft(user, id, lock);
    if (draft == null) throw new ApiFailure(404, "PLAN_NOT_FOUND");
    return draft;
  }

  private Map<String, Object> draftView(AssistantStore.Draft draft) {
    return Map.of(
        "id",
        draft.id(),
        "status",
        draft.status(),
        "version",
        draft.version(),
        "payload",
        AssistantJson.parse(draft.payloadJson()));
  }

  @Transactional
  public Map<String, Object> confirm(String user, String id, int version) {
    var draft = requireDraft(user, id, true);
    if (version != 1) throw new ApiFailure(409, "PLAN_VERSION_CONFLICT");
    if (draft.status().equals("DRAFT")) store.confirm(user, id, version);
    return draftView(requireDraft(user, id, false));
  }

  @Transactional
  public void publish(AssistantStore.Run run, String draftId, CoachEngine.Result result) {
    var json =
        AssistantJson.JSON.writeValueAsString(
            Map.of("draftId", draftId, "evidence", result.evidence()));
    if (store.complete(run, json) != 1) throw new ApiFailure(409, "AGENT_EXECUTION_EXPIRED");
    store.insertDraft(draftId, run, AssistantJson.JSON.writeValueAsString(result.payload()));
  }

  private void uuid(String id) {
    try {
      if (!UUID.fromString(id).toString().equalsIgnoreCase(id))
        throw new IllegalArgumentException();
    } catch (Exception ex) {
      throw new ApiFailure(422, "INVALID_INPUT");
    }
  }
}
