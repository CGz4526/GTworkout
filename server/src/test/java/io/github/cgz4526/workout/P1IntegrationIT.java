package io.github.cgz4526.workout;

import java.io.ByteArrayInputStream;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import io.github.cgz4526.workout.backup.*;
import io.github.cgz4526.workout.identity.*;
import io.github.cgz4526.workout.shared.ApiFailure;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

class P1IntegrationIT extends PostgresTestBase {
    @Value("${local.server.port}") int port;
    @Autowired IdentityService identity;
    @Autowired BackupService backups;
    @Autowired BackupMapper mapper;
    @Autowired BackupValidator validator;
    @Autowired TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;
    final JsonMapper json = JsonMapper.builder().build();
    static final String PASSWORD = "test-password-only";
    static final byte[] FILE = "{\"version\":3,\"exercises\":[],\"templates\":[],\"sessions\":[],\"weights\":[],\"futureField\":{\"keep\":true}}\n".getBytes(StandardCharsets.UTF_8);

    String username() { return "u_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20); }
    UserAccount.PublicUser user() { return identity.register(username(), PASSWORD); }
    HttpClient client() { return HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build(); }
    HttpResponse<byte[]> request(HttpClient client, String path, String method, String contentType, byte[] body, String csrf, String key) throws Exception {
        return request(client, path, method, contentType, body, csrf, key, null);
    }
    HttpResponse<byte[]> request(HttpClient client, String path, String method, String contentType, byte[] body, String csrf, String key, String expectedUser) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1" + path));
        if (contentType != null) builder.header("Content-Type", contentType);
        if (csrf != null) builder.header("X-CSRF-TOKEN", csrf);
        if (key != null) {
            builder.header("Idempotency-Key", key);
            if (expectedUser == null) {
                var me = request(client, "/auth/me", "GET", null, null, null, null);
                expectedUser = tree(me).path("id").asString();
            }
            builder.header("X-Expected-User", expectedUser);
        }
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(body));
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
    }
    JsonNode tree(HttpResponse<byte[]> response) { return json.readTree(response.body()); }
    String csrf(HttpClient client) throws Exception {
        var result = request(client, "/auth/csrf", "GET", null, null, null, null);
        assertThat(result.statusCode()).isEqualTo(200);
        return tree(result).path("token").asString();
    }
    HttpClient login(UserAccount.PublicUser user) throws Exception {
        var client = client();
        var result = request(client, "/auth/login", "POST", "application/x-www-form-urlencoded",
                ("username=" + user.username() + "&password=" + PASSWORD).getBytes(StandardCharsets.UTF_8), csrf(client), null);
        assertThat(result.statusCode()).isEqualTo(200);
        return client;
    }
    HttpResponse<byte[]> upload(HttpClient client, String key, byte[] file, String timezone) throws Exception {
        return upload(client, key, file, timezone, null);
    }
    HttpResponse<byte[]> upload(HttpClient client, String key, byte[] file, String timezone, String expectedUser) throws Exception {
        String boundary = "WorkoutBoundary";
        var bytes = new java.io.ByteArrayOutputStream();
        bytes.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"timezone\"\r\n\r\n" + timezone
                + "\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.json\"\r\nContent-Type: application/json\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        bytes.write(file); bytes.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return request(client, "/backups", "POST", "multipart/form-data; boundary=" + boundary, bytes.toByteArray(), csrf(client), key, expectedUser);
    }

    @Test void authenticationPersistsInJdbcAndLogoutInvalidatesSession() throws Exception {
        var client = client();
        String name = username();
        byte[] registration = json.writeValueAsBytes(Map.of("username", name.toUpperCase(Locale.ROOT), "password", PASSWORD));
        assertThat(request(client, "/auth/register", "POST", "application/json", registration, null, null).statusCode()).isEqualTo(403);
        var created = request(client, "/auth/register", "POST", "application/json", registration, csrf(client), null);
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(tree(created).path("username").asString()).isEqualTo(name);
        assertThat(new String(created.body(), StandardCharsets.UTF_8)).doesNotContain(PASSWORD, "passwordHash");
        String oldCsrf = csrf(client);
        var loggedIn = request(client, "/auth/login", "POST", "application/x-www-form-urlencoded",
                ("username=" + name + "&password=" + PASSWORD).getBytes(StandardCharsets.UTF_8), oldCsrf, null);
        assertThat(loggedIn.statusCode()).isEqualTo(200);
        assertThat(request(client, "/auth/me", "GET", null, null, null, null).statusCode()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM spring_session WHERE principal_name=?", Long.class, name)).isEqualTo(1);
        String sessionCookie = ((CookieManager) client.cookieHandler().orElseThrow()).getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("SESSION")).findFirst().orElseThrow().getValue();
        assertThat(request(client, "/auth/logout", "POST", null, null, oldCsrf, null).statusCode()).isEqualTo(403);
        assertThat(request(client, "/auth/logout", "POST", null, null, csrf(client), null).statusCode()).isEqualTo(204);
        assertThat(request(client, "/auth/me", "GET", null, null, null, null).statusCode()).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM spring_session WHERE principal_name=?", Long.class, name)).isZero();
        var staleSession = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth/me"))
                .header("Cookie", "SESSION=" + sessionCookie).build();
        assertThat(HttpClient.newHttpClient().send(staleSession, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(401);
    }

    @Test void backupRetriesDownloadAndTwoUserIsolation() throws Exception {
        var owner = user(); var client = login(owner); var other = login(user());
        String key = UUID.randomUUID().toString();
        var created = upload(client, key, FILE, "Asia/Shanghai");
        assertThat(created.statusCode()).withFailMessage(new String(created.body(), StandardCharsets.UTF_8)).isEqualTo(202);
        String id = tree(created).path("id").asString();
        assertThat(tree(created).path("projectionStatus").asString()).isEqualTo("PROCESSING");
        assertThat(tree(created).path("jobId").asString()).isNotBlank();
        var replay = upload(client, key, FILE, "Asia/Shanghai");
        assertThat(replay.statusCode()).isEqualTo(200);
        assertThat(tree(replay).path("id").asString()).isEqualTo(id);
        assertThat(mapper.count(owner.id())).isEqualTo(1);
        assertThat(upload(client, key, FILE, "UTC").statusCode()).isEqualTo(409);
        var download = request(client, "/backups/" + id + "/download", "GET", null, null, null, null);
        assertThat(download.body()).isEqualTo(FILE);
        assertThat(download.headers().firstValue("Content-Disposition").orElseThrow()).startsWith("attachment;");
        assertThat(request(other, "/backups/" + id, "GET", null, null, null, null).statusCode()).isEqualTo(404);
        assertThat(request(other, "/backups/" + id + "/download", "GET", null, null, null, null).statusCode()).isEqualTo(404);
        assertThat(tree(request(other, "/backups", "GET", null, null, null, null)).path("items").size()).isZero();
    }

    @Test void realPostgresSerializesConcurrentRetriesAndQuotaChecks() throws Exception {
        var owner = user();
        var data = validator.validate(new ByteArrayInputStream(FILE));
        var same = UploadIdentity.fromDigest(UUID.randomUUID().toString(), "UTC", data.digest());
        ExecutorService pool = Executors.newFixedThreadPool(6);
        try {
            var tasks = new ArrayList<Callable<String>>();
            for (int i = 0; i < 6; i++) tasks.add(() -> backups.save(owner.id(), same, data).backup().id());
            Set<String> ids = new HashSet<>();
            for (var result : pool.invokeAll(tasks)) ids.add(result.get());
            assertThat(ids).hasSize(1);
            assertThat(mapper.count(owner.id())).isEqualTo(1);
            var quotaTasks = new ArrayList<Callable<Integer>>();
            for (int i = 0; i < 6; i++) quotaTasks.add(() -> {
                try { backups.save(owner.id(), UploadIdentity.fromDigest(UUID.randomUUID().toString(), "UTC", data.digest()), data); return 201; }
                catch (ApiFailure ex) { return ex.status(); }
            });
            List<Integer> results = new ArrayList<>();
            for (var result : pool.invokeAll(quotaTasks)) results.add(result.get());
            assertThat(results).containsExactlyInAnyOrder(201, 201, 429, 429, 429, 429);
            assertThat(mapper.count(owner.id())).isEqualTo(3);
            assertThat(backups.save(owner.id(), same, data).created()).isFalse();
        } finally { pool.shutdownNow(); }
    }

    @Test void failureAfterInsertRollsBackAndCursorPagesDoNotOverlap() throws Exception {
        var owner = user(); var data = validator.validate(new ByteArrayInputStream(FILE));
        assertThatThrownBy(() -> tx.execute(status -> {
            backups.save(owner.id(), UploadIdentity.fromDigest(UUID.randomUUID().toString(), "UTC", data.digest()), data);
            throw new ApiFailure(500, "SYNTHETIC_ROLLBACK");
        })).isInstanceOf(ApiFailure.class);
        assertThat(mapper.count(owner.id())).isZero();
        for (int i = 0; i < 3; i++) backups.save(owner.id(), UploadIdentity.fromDigest(UUID.randomUUID().toString(), "UTC", data.digest()), data);
        var first = backups.list(owner.id(), 2, null);
        var next = backups.list(owner.id(), 2, first.nextCursor());
        assertThat(first.items()).hasSize(2);
        assertThat(next.items()).hasSize(1).doesNotContainAnyElementsOf(first.items());
        assertThat(next.nextCursor()).isNull();
    }

    @Test void invalidUploadDoesNotCreateResource() throws Exception {
        var owner = user(); var client = login(owner);
        assertThat(upload(client, UUID.randomUUID().toString(), "{broken".getBytes(StandardCharsets.UTF_8), "UTC").statusCode()).isEqualTo(422);
        assertThat(mapper.count(owner.id())).isZero();
    }

    @Test void servletRejectsOversizedFileAndReturnsProblemDetails() throws Exception {
        var owner = user(); var client = login(owner);
        var response = upload(client, UUID.randomUUID().toString(), new byte[BackupValidator.MAX_BYTES + 1], "UTC");
        assertThat(response.statusCode()).isEqualTo(413);
        assertThat(tree(response).path("traceId").asString()).isNotBlank();
        assertThat(mapper.count(owner.id())).isZero();
    }

    @Test void concurrentRegistrationCannotCreateDuplicateUsername() throws Exception {
        String username = username();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Callable<Integer> registration = () -> {
                try { identity.register(username, PASSWORD); return 201; }
                catch (ApiFailure ex) { return ex.status(); }
            };
            List<Integer> results = new ArrayList<>();
            for (var result : pool.invokeAll(List.of(registration, registration))) results.add(result.get());
            assertThat(results).containsExactlyInAnyOrder(201, 409);
        } finally { pool.shutdownNow(); }
    }

    @Test void accountSwitchCannotRedirectPreviouslyConfirmedUpload() throws Exception {
        var original = user(); var actual = user(); var client = login(actual);
        var response = upload(client, UUID.randomUUID().toString(), FILE, "UTC", original.id());
        assertThat(response.statusCode()).isEqualTo(409);
        assertThat(tree(response).path("code").asString()).isEqualTo("ACCOUNT_CHANGED");
        assertThat(mapper.count(original.id())).isZero();
        assertThat(mapper.count(actual.id())).isZero();
    }
}
