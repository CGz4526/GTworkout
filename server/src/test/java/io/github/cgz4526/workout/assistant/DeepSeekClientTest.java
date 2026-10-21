package io.github.cgz4526.workout.assistant;

import static org.assertj.core.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class DeepSeekClientTest {
  final List<Map<String, Object>> messages =
      List.of(Map.of("role", "user", "content", "synthetic only json"));

  @Test
  void protocolUsesBoundedNonThinkingJsonAndReportsTokens() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var requests = new AtomicInteger();
    server.createContext(
        "/",
        exchange -> {
          var body =
              AssistantJson.parse(
                  new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          assertThat(body.path("max_tokens").asInt()).isEqualTo(2048);
          assertThat(body.path("thinking").path("type").asText()).isEqualTo("disabled");
          requests.incrementAndGet();
          byte[] response =
              "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"role\":\"assistant\",\"content\":\"{}\"}}],\"usage\":{\"total_tokens\":12}}"
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, response.length);
          exchange.getResponseBody().write(response);
          exchange.close();
        });
    server.start();
    try {
      var client =
          new DeepSeekClient(
              "synthetic-only",
              "fake",
              URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"));
      assertThat(client.complete(messages, List.of(), true, Duration.ofSeconds(3)).totalTokens())
          .isEqualTo(12);
      assertThat(requests.get()).isEqualTo(1);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void redirectsHttpFailuresAndOversizedBodiesAreNotRetried() throws Exception {
    for (int status : List.of(302, 401, 429, 500, 200)) {
      var requests = new AtomicInteger();
      var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext(
          "/",
          exchange -> {
            requests.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            exchange.getResponseHeaders().add("Location", "/redirected");
            byte[] bytes = "x".repeat(status == 200 ? 140000 : 10).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            try {
              exchange.getResponseBody().write(bytes);
            } catch (Exception ignored) {
              /* Subscriber cancels oversized body. */
            }
            exchange.close();
          });
      server.start();
      try {
        var client =
            new DeepSeekClient(
                "synthetic-only",
                "fake",
                URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"));
        assertThatThrownBy(() -> client.complete(messages, List.of(), true, Duration.ofSeconds(3)))
            .isInstanceOf(io.github.cgz4526.workout.shared.ApiFailure.class);
        assertThat(requests.get()).isEqualTo(1);
      } finally {
        server.stop(0);
      }
    }
  }

  @Test
  void absentConfigurationAndLargeContextNeverMakeRequest() {
    var client = new DeepSeekClient("", "", URI.create("http://127.0.0.1:1"));
    assertThatThrownBy(() -> client.complete(messages, List.of(), true, Duration.ofSeconds(1)))
        .hasMessage("ASSISTANT_NOT_CONFIGURED");
    var configured = new DeepSeekClient("synthetic-only", "fake", URI.create("http://127.0.0.1:1"));
    assertThatThrownBy(
            () ->
                configured.complete(
                    List.of(Map.of("role", "user", "content", "x".repeat(50000))),
                    List.of(),
                    true,
                    Duration.ofSeconds(1)))
        .hasMessage("AGENT_CONTEXT_LIMIT");
  }

  @Test
  void firstRoundRequiresBoundComparisonToolBeforeJsonDraft() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var rounds = new AtomicInteger();
    server.createContext(
        "/",
        exchange -> {
          var body =
              AssistantJson.parse(
                  new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          if (rounds.getAndIncrement() == 0) {
            assertThat(body.path("tool_choice").path("function").path("name").asText())
                .isEqualTo("compareTrainingPeriods");
            assertThat(body.has("response_format")).isFalse();
          } else {
            assertThat(body.path("tool_choice").asText()).isEqualTo("auto");
            assertThat(body.path("response_format").path("type").asText()).isEqualTo("json_object");
          }
          byte[] response =
              "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"role\":\"assistant\",\"content\":\"{}\"}}],\"usage\":{\"total_tokens\":1}}"
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, response.length);
          exchange.getResponseBody().write(response);
          exchange.close();
        });
    server.start();
    try {
      var client =
          new DeepSeekClient(
              "synthetic-only",
              "fake",
              URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"));
      client.complete(messages, CoachTools.definitions(), false, Duration.ofSeconds(3));
      var next = new ArrayList<>(messages);
      next.add(Map.of("role", "tool", "tool_call_id", "one", "content", "{}"));
      client.complete(next, CoachTools.definitions(), false, Duration.ofSeconds(3));
      assertThat(rounds.get()).isEqualTo(2);
    } finally {
      server.stop(0);
    }
  }
}
