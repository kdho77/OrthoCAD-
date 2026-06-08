from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import manufacturing
from app.services.exceptions import ManufacturingServiceError

app = FastAPI(title="Vertex Manufacturing Service", version="0.1.0")


@app.exception_handler(ManufacturingServiceError)
async def manufacturing_service_error_handler(
    _request: Request,
    exc: ManufacturingServiceError,
) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(manufacturing.router, prefix="/api/v1/manufacturing")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
