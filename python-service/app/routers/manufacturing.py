from fastapi import APIRouter

from app.dependencies import InternalServiceAuth
from app.models.requests import GenerateSolidRequest
from app.models.responses import GenerateSolidResponse
from app.services.geometry_utils import generate_solid

router = APIRouter(tags=["manufacturing"])


@router.post("/generate-solid", response_model=GenerateSolidResponse)
async def generate_solid_endpoint(
    request: GenerateSolidRequest,
    _: InternalServiceAuth,
) -> GenerateSolidResponse:
    return generate_solid(request)
