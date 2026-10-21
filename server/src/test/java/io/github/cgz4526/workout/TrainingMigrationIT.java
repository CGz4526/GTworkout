package io.github.cgz4526.workout;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

class TrainingMigrationIT {
  @Test
  void upgradesV4WithoutLosingAccountsAndDoesNotReapplyV5() throws Exception {
    try (var pg = new PostgreSQLContainer(DockerImageName.parse(
        "postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94")
        .asCompatibleSubstituteFor("postgres"))) {
      pg.start();
      Flyway.configure().dataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword())
          .target("4").load().migrate();
      try (var connection = DriverManager.getConnection(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword());
          var statement = connection.createStatement()) {
        statement.executeUpdate("INSERT INTO app_user(id,normalized_username,password_hash) VALUES "
            + "('00000000-0000-0000-0000-000000000001','migration_fixture','synthetic_hash')");
      }
      var flyway = Flyway.configure().dataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword()).load();
      assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
      flyway.validate();
      assertThat(flyway.migrate().migrationsExecuted).isZero();
      try (var connection = DriverManager.getConnection(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword());
          var statement = connection.createStatement()) {
        try (var rows = statement.executeQuery("SELECT normalized_username FROM app_user")) {
          assertThat(rows.next()).isTrue();
          assertThat(rows.getString(1)).isEqualTo("migration_fixture");
        }
        try (var rows = statement.executeQuery("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
            + "AND table_name IN ('live_exercise','live_session','live_session_exercise','live_set','training_mutation')")) {
          assertThat(rows.next()).isTrue();
          assertThat(rows.getInt(1)).isEqualTo(5);
        }
      }
    }
  }
}
