package io.github.cgz4526.workout;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class WorkoutApplication {
    public static void main(String[] args) {
        SpringApplication.run(WorkoutApplication.class, args);
    }
}
