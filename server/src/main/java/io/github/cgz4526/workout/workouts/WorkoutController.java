package io.github.cgz4526.workout.workouts;

import java.io.IOException;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import io.github.cgz4526.workout.identity.IdentityService;
import io.github.cgz4526.workout.shared.ApiFailure;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/v1")
public class WorkoutController {
    private final WorkoutService service;
    private final IdentityService identity;
    private final WorkoutImportService imports;
    public WorkoutController(WorkoutService service,IdentityService identity,WorkoutImportService imports) { this.service=service; this.identity=identity; this.imports=imports; }
    private String user(Authentication auth,String expected) {
        service.requireEnabled(); String id=identity.current(auth).id();
        if(expected==null||!id.equals(expected)) throw new ApiFailure(409,"ACCOUNT_CHANGED");
        return id;
    }
    @PostMapping(value="/workout-sessions",consumes=MediaType.APPLICATION_JSON_VALUE)
    public JsonNode create(Authentication auth,@RequestHeader("X-Expected-User") String expected,HttpServletRequest request) throws IOException {
        return save(auth,expected,null,request);
    }
    @PutMapping(value="/workout-sessions/{id}",consumes=MediaType.APPLICATION_JSON_VALUE)
    public JsonNode update(Authentication auth,@RequestHeader("X-Expected-User") String expected,@PathVariable UUID id,HttpServletRequest request) throws IOException {
        return save(auth,expected,id,request);
    }
    private JsonNode save(Authentication auth,String expected,UUID id,HttpServletRequest request) throws IOException {
        String user=user(auth,expected);
        WorkoutInput.Validated input;
        try { input=WorkoutInput.read(request.getInputStream(),id); }
        catch(IllegalArgumentException ex) { throw new ApiFailure(ex.getMessage().equals("WORKOUT_TOO_LARGE")?413:422,"INVALID_WORKOUT_INPUT"); }
        return service.save(user,input);
    }
    @GetMapping("/workout-sessions/{id}")
    public WorkoutService.View get(Authentication auth,@RequestHeader("X-Expected-User") String expected,@PathVariable String id) { return service.get(user(auth,expected),id); }
    @GetMapping("/workout-sessions")
    public WorkoutService.Page list(Authentication auth,@RequestHeader("X-Expected-User") String expected,@RequestParam(defaultValue="20") int limit,@RequestParam(required=false) String cursor) { return service.list(user(auth,expected),limit,cursor); }
    @PostMapping(value="/exercises",consumes=MediaType.APPLICATION_JSON_VALUE)
    public JsonNode exercise(Authentication auth,@RequestHeader("X-Expected-User") String expected,HttpServletRequest request) throws IOException {
        String user=user(auth,expected); WorkoutInput.ExerciseInput input;
        try { input=WorkoutInput.readExercise(request.getInputStream()); }
        catch(IllegalArgumentException ex) { throw new ApiFailure(ex.getMessage().equals("WORKOUT_TOO_LARGE")?413:422,"INVALID_EXERCISE_INPUT"); }
        return service.createExercise(user,input);
    }
    @GetMapping("/exercises")
    public WorkoutService.ExercisePage exercises(Authentication auth,@RequestHeader("X-Expected-User") String expected,@RequestParam(defaultValue="100") int limit,@RequestParam(required=false) String cursor) { return service.exercises(user(auth,expected),limit,cursor); }
    @GetMapping("/training-imports/{backupId}/preview")
    public WorkoutImportService.Preview preview(Authentication auth,@RequestHeader("X-Expected-User") String expected,@PathVariable String backupId) { return imports.preview(user(auth,expected),backupId); }
    @PostMapping(value="/training-imports/{backupId}/commit",consumes=MediaType.APPLICATION_JSON_VALUE)
    public WorkoutImportService.Result commit(Authentication auth,@RequestHeader("X-Expected-User") String expected,@PathVariable String backupId,HttpServletRequest request) throws IOException {
        String user=user(auth,expected); WorkoutInput.ImportConfirmation confirmation;
        try { confirmation=WorkoutInput.readImportConfirmation(request.getInputStream()); }
        catch(IllegalArgumentException ex) { throw new ApiFailure(ex.getMessage().equals("WORKOUT_TOO_LARGE")?413:422,"INVALID_IMPORT_CONFIRMATION"); }
        return imports.commit(user,backupId,confirmation.sha256(),confirmation.acceptPartial());
    }
}
