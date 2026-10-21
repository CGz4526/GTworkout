FROM maven:3.9.9-eclipse-temurin-17@sha256:f58d59b6273e785ac0a4477f6e9b5ba1d7731c75b906c0f7b34076f1851318cc AS build
WORKDIR /build
COPY server/pom.xml .
COPY server/.mvn .mvn
COPY server/src src
RUN --mount=type=cache,target=/root/.m2 mvn -B package

FROM eclipse-temurin:17-jre-alpine@sha256:3c472129dc75a8d1d7a3f2df5b2093a8077e4493deff046754d4764d0371de63
RUN addgroup -S workout && adduser -S workout -G workout
WORKDIR /app
COPY --from=build --chown=workout:workout /build/target/workout-server-0.1.0.jar app.jar
USER workout
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
