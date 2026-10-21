package io.github.cgz4526.workout;

import java.util.UUID;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
      "workout.registration-enabled=true",
      "workout.max-users=100",
      "workout.backup.max-versions=3",
      "workout.jobs.enabled=false",
      "workout.assistant.api-key=",
      "workout.assistant.model="
    })
abstract class PostgresTestBase {
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
              DockerImageName.parse(
                      "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
                  .asCompatibleSubstituteFor("postgres"))
          .withDatabaseName("workout_test")
          .withUsername("workout_test")
          .withPassword(UUID.randomUUID().toString());

  static {
    POSTGRES.start();
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
  }
}
