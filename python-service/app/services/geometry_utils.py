from app.models.requests import GenerateSolidRequest
from app.models.responses import GenerateSolidResponse
from app.services.exceptions import InvalidRequestError


def generate_solid(request: GenerateSolidRequest) -> GenerateSolidResponse:
    """Stub geometry entry point — real solid generation is implemented in a later phase."""
    if request.thickness_mm <= 0:
        raise InvalidRequestError("thickness_mm must be positive")

    if request.grinding_style.type == "straight" and request.grinding_style.angle_degrees is None:
        raise InvalidRequestError("angle_degrees is required for straight grinding style")

    if request.grinding_style.type == "rounded" and request.grinding_style.radius_mm is None:
        raise InvalidRequestError("radius_mm is required for rounded grinding style")

    return GenerateSolidResponse(
        job_id=request.job_id,
        solid_stl_base64=None,
        solid_url=None,
        metadata={
            "status": "stub",
            "design_id": request.design_id,
            "preset_id": request.preset_id,
            "message": "Geometry generation not yet implemented",
        },
    )
