package io.github.cgz4526.workout.assistant;

import io.github.cgz4526.workout.shared.ApiFailure;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class DeepSeekClient implements ModelGateway {
  private final String key, model;
  private final URI endpoint;
  private final HttpClient http;

  @org.springframework.beans.factory.annotation.Autowired
  public DeepSeekClient(
      @Value("${workout.assistant.api-key:}") String key,
      @Value("${workout.assistant.model:}") String model) {
    this(key, model, URI.create("https://api.deepseek.com/chat/completions"));
  }

  // Package-private seam for local fake HTTP server tests, never configurable by a request.
  DeepSeekClient(String key, String model, URI endpoint) {
    this.key = key;
    this.model = model;
    this.endpoint = endpoint;
    this.http =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
  }

  public boolean configured() {
    return !key.isBlank() && !model.isBlank() && model.length() <= 100;
  }

  public String model() {
    return model;
  }

  public Reply complete(
      List<Map<String, Object>> messages,
      List<Map<String, Object>> tools,
      boolean finalOnly,
      Duration remaining) {
    if (!configured()) throw new ApiFailure(503, "ASSISTANT_NOT_CONFIGURED");
    long timeout = Math.min(35000, remaining.toMillis());
    if (timeout <= 0) throw new ApiFailure(503, "AGENT_DEADLINE_EXCEEDED");
    var body = new LinkedHashMap<String, Object>();
    body.put("model", model);
    body.put("messages", messages);
    body.put("max_tokens", 2048);
    body.put("stream", false);
    body.put("thinking", Map.of("type", "disabled"));
    boolean hasToolResult = messages.stream().anyMatch(m -> "tool".equals(m.get("role")));
    if (finalOnly || tools.isEmpty() || hasToolResult)
      body.put("response_format", Map.of("type", "json_object"));
    if (!tools.isEmpty()) {
      body.put("tools", tools);
      // Always obtain the evidence through the bound tool before drafting. Auto choice
      // can otherwise skip tools because the initial prompt already contains evidence.
      body.put(
          "tool_choice",
          finalOnly
              ? "none"
              : hasToolResult
                  ? "auto"
                  : Map.of(
                      "type", "function", "function", Map.of("name", "compareTrainingPeriods")));
    }
    byte[] bytes = AssistantJson.JSON.writeValueAsBytes(body);
    if (bytes.length > 49152) throw new ApiFailure(422, "AGENT_CONTEXT_LIMIT");
    var request =
        HttpRequest.newBuilder(endpoint)
            .timeout(Duration.ofMillis(timeout))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + key)
            .POST(HttpRequest.BodyPublishers.ofByteArray(bytes))
            .build();
    CompletableFuture<HttpResponse<byte[]>> future = null;
    try {
      future = http.sendAsync(request, info -> new LimitedBody());
      var response = future.get(timeout, TimeUnit.MILLISECONDS);
      if (response.statusCode() != 200) throw new ApiFailure(503, "MODEL_HTTP_ERROR");
      var root = AssistantJson.parse(new String(response.body(), StandardCharsets.UTF_8));
      var choice = root.path("choices");
      if (!choice.isArray() || choice.size() != 1)
        throw new ApiFailure(422, "INVALID_MODEL_OUTPUT");
      String finish = choice.get(0).path("finish_reason").asText();
      var message = choice.get(0).path("message");
      if (!(finish.equals("stop") || finish.equals("tool_calls"))
          || !message.isObject()
          || !message.path("role").asText().equals("assistant"))
        throw new ApiFailure(422, "INVALID_MODEL_OUTPUT");
      var tokens = root.path("usage").path("total_tokens");
      if (!tokens.isIntegralNumber() || !tokens.canConvertToLong() || tokens.asLong() < 0)
        throw new ApiFailure(422, "INVALID_MODEL_OUTPUT");
      return new Reply(message, tokens.asLong());
    } catch (ApiFailure ex) {
      throw ex;
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new ApiFailure(503, "MODEL_INTERRUPTED");
    } catch (Exception ex) {
      throw new ApiFailure(503, "MODEL_UNAVAILABLE");
    } finally {
      if (future != null && !future.isDone()) future.cancel(true);
    }
  }

  private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final CompletableFuture<byte[]> result = new CompletableFuture<>();
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    private Flow.Subscription subscription;

    public CompletionStage<byte[]> getBody() {
      return result;
    }

    public void onSubscribe(Flow.Subscription s) {
      subscription = s;
      s.request(1);
    }

    public void onNext(List<ByteBuffer> buffers) {
      for (var b : buffers) {
        if (out.size() + b.remaining() > 131072) {
          subscription.cancel();
          result.completeExceptionally(new IllegalArgumentException());
          return;
        }
        byte[] bytes = new byte[b.remaining()];
        b.get(bytes);
        out.writeBytes(bytes);
      }
      subscription.request(1);
    }

    public void onError(Throwable error) {
      result.completeExceptionally(error);
    }

    public void onComplete() {
      result.complete(out.toByteArray());
    }
  }
}
