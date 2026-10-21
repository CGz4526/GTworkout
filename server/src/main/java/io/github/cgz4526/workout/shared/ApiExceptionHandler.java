package io.github.cgz4526.workout.shared;

import org.springframework.http.ProblemDetail;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {
    @ExceptionHandler(ApiFailure.class)
    ResponseEntity<ProblemDetail> business(ApiFailure ex, WebRequest request) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(ex.status()), ex.code());
        problem.setProperty("code", ex.code());
        problem.setProperty("traceId", request.getAttribute("traceId", RequestAttributes.SCOPE_REQUEST));
        return ResponseEntity.status(ex.status()).body(problem);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ProblemDetail> invalid(IllegalArgumentException ex, WebRequest request) {
        return business(new ApiFailure(422, "INVALID_INPUT"), request);
    }
    @Override
    protected ResponseEntity<Object> createResponseEntity(Object body, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        var problem = ProblemDetail.forStatus(status);
        problem.setProperty("code", "HTTP_" + status.value());
        problem.setProperty("traceId", request.getAttribute("traceId", RequestAttributes.SCOPE_REQUEST));
        return super.createResponseEntity(problem, headers, status, request);
    }

    @ExceptionHandler(Exception.class)
    ProblemDetail unexpected(Exception ex, WebRequest request) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "服务暂时无法完成请求");
        problem.setProperty("code", "INTERNAL_ERROR");
        problem.setProperty("traceId", request.getAttribute("traceId", RequestAttributes.SCOPE_REQUEST));
        logger.error("Unexpected request failure; exceptionType=" + ex.getClass().getName()
                + "; traceId=" + request.getAttribute("traceId", RequestAttributes.SCOPE_REQUEST));
        return problem;
    }
}
