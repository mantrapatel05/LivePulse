class AppError extends Error {
    constructor(message, status=500, code="internal_error"){
        super(message);
        this.status = status;
        this.code = code;
    }
}

class ValidationError extends AppError {
    constructor(message, details=[]){
        super(message,400,"validation_error")
        this.details = details
    }
}

class RateLimitError extends AppError {
    constructor(message, retryAfterSeconds) {
        super(message, 429, "rate_limited");
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

class AuthError extends AppError {
    constructor(message, status = 401) {
        super(message, status, "auth_error");
    }
}

module.exports = {
    AppError,
    ValidationError,
    RateLimitError,
    AuthError
}