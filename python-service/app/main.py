# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
FastAPI orchestration layer for the OrthoCAD hybrid manufacturing service.

Accepts a finished STL exported from the client viewer, validates watertightness,
then dispatches to G-code slicing (known Vertex belt profiles) or returns the STL
as-is for external printers (SLS, SLA, etc.).
"""

from __future__ import annotations

import base64
import logging
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from app.models.requests import GenerateSolidRequest
from app.services.belt_transformer import apply_belt_transform
from app.services.presets import get_preset, is_known_preset
from app.services.slicer import build_slice_overrides, generate_gcode_from_solid
from app.services.stl_loader import download_stl_to_temp, load_watertight_stl

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("manufacturing")

app = FastAPI(
    title="OrthoCAD Hybrid Manufacturing Service",
    version="0.2.0",
    description="Finished STL validation + belt transform + slicing for orthotic manufacturing.",
)


def verify_internal_key(authorization: str | None = Header(default=None)) -> None:
    """Optional internal-service auth.

    When MANUFACTURING_INTERNAL_API_KEY is set, every /manufacture call must send
    `Authorization: Bearer <key>`. When it is unset (local/dev), auth is skipped.
    """
    expected = os.environ.get("MANUFACTURING_INTERNAL_API_KEY", "").strip()
    if not expected:
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing internal service credentials")
    token = authorization.split(" ", 1)[1].strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Invalid internal service credentials")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "hybrid-manufacturing"}


@app.post("/manufacture")
async def manufacture(req: GenerateSolidRequest, _: None = Depends(verify_internal_key)) -> JSONResponse:
    """
    Main entry point for the hybrid pipeline.

    1. Download finished STL from client upload URL.
    2. Validate / repair watertightness (fail loudly if still leaky).
    3. Dispatch on output_type:
       - gcode: belt transform (when applicable) + slice
       - stl: return validated (possibly repaired) STL bytes
    """
    belt_angle = float(req.belt_angle_deg or 45.0)
    output_type = req.output_type

    # Unknown presets default to STL passthrough (external printers).
    if output_type == "gcode" and not is_known_preset(req.preset_id):
        logger.warning(
            "preset_id %r is not a known Vertex profile — returning STL instead of G-code",
            req.preset_id,
        )
        output_type = "stl"

    grinding_label = req.grinding_style.type if req.grinding_style else None

    logger.info(
        "manufacture start job=%s design=%s preset=%s output=%s belt=%.1f side=%s",
        req.job_id,
        req.design_id,
        req.preset_id,
        output_type,
        belt_angle,
        req.side,
    )

    local_stl = download_stl_to_temp(req.stl_url)
    downloaded = req.stl_url.startswith(("http://", "https://"))

    try:
        solid = load_watertight_stl(local_stl)
        preset = get_preset(req.preset_id)
        preset["beltAngleDeg"] = belt_angle

        if output_type == "stl":
            stl_bytes = solid.export(file_type="stl")
            logger.info("manufacture ok job=%s output=stl bytes=%d", req.job_id, len(stl_bytes))
            return JSONResponse(
                {
                    "ok": True,
                    "job_id": req.job_id,
                    "design_id": req.design_id,
                    "preset_id": req.preset_id,
                    "output_type": "stl",
                    "belt_angle_deg": belt_angle,
                    "grinding_style": grinding_label,
                    "stl_base64": base64.b64encode(stl_bytes).decode("ascii"),
                    "metadata": {"side": req.side, "faces": len(solid.faces)},
                }
            )

        # G-code path: belt transform then slice with UI overrides on preset defaults.
        transformed = apply_belt_transform(solid, belt_angle)
        overrides = build_slice_overrides(
            preset,
            layer_height_mm=req.layer_height_mm,
            infill_density=req.infill_density,
            perimeters=req.perimeters,
        )
        gcode = generate_gcode_from_solid(transformed, preset, overrides)

        logger.info("manufacture ok job=%s output=gcode bytes=%d", req.job_id, len(gcode))
        return JSONResponse(
            {
                "ok": True,
                "job_id": req.job_id,
                "design_id": req.design_id,
                "preset_id": req.preset_id,
                "output_type": "gcode",
                "belt_angle_deg": belt_angle,
                "grinding_style": grinding_label,
                "gcode": gcode,
                "metadata": {
                    "side": req.side,
                    "layerHeightMm": overrides["layerHeightMm"],
                    "infillDensity": overrides["infillDensity"],
                    "perimeters": overrides["perimeters"],
                },
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("manufacture failed job=%s: %s", req.job_id, e)
        raise HTTPException(status_code=500, detail=f"Manufacturing failed: {str(e)}") from e
    finally:
        if downloaded:
            try:
                os.unlink(local_stl)
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=True)
