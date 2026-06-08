class ManufacturingServiceError(Exception):
    """Base error for manufacturing service failures."""

    def __init__(self, message: str, *, status_code: int = 500) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class InvalidRequestError(ManufacturingServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)


class GeometryProcessingError(ManufacturingServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=422)


class UnauthorizedServiceError(ManufacturingServiceError):
    def __init__(self, message: str = "Unauthorized internal service call") -> None:
        super().__init__(message, status_code=401)
