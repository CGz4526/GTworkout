package io.github.cgz4526.workout;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import static org.assertj.core.api.Assertions.assertThat;

class BoundaryIT extends PostgresTestBase {
    @Value("${local.server.port}") int port;
    final HttpClient client = HttpClient.newHttpClient();

    HttpResponse<String> request(String path, boolean post) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
        if (post) builder.POST(HttpRequest.BodyPublishers.noBody());
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test void statusReportsUnavailableFeatures() throws Exception {
        var response = request("/api/status", false);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"backup\":true", "\"assistant\":false");
        assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store");
    }
    @Test void anonymousRequestsAreRejectedWithTrace() throws Exception {
        var response = request("/api/backups", false);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.headers().firstValue("Content-Type")).hasValue("application/problem+json;charset=UTF-8");
        assertThat(response.body()).contains("AUTHENTICATION_REQUIRED", response.headers().firstValue("X-Trace-Id").orElseThrow());
    }
    @Test void writesRequireCsrf() throws Exception {
        assertThat(request("/api/backups", true).statusCode()).isEqualTo(403);
    }
    @Test void probesArePublicButOtherActuatorEndpointsAreProtected() throws Exception {
        assertThat(request("/actuator/health/liveness", false).statusCode()).isEqualTo(200);
        assertThat(request("/actuator/health/readiness", false).statusCode()).isEqualTo(200);
        assertThat(request("/actuator/env", false).statusCode()).isEqualTo(401);
    }
    @Test void statusDoesNotNegotiateHtmlAsSuccess() throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/status"))
                .header("Accept", "text/html").build();
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(406);
        assertThat(response.body()).contains("HTTP_406", "traceId");
    }
}
