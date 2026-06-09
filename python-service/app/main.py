# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Minimal FastAPI orchestration layer for the OrthoCAD hybrid manufacturing service.

This is a thin service layer:
- Validates incoming requests (via Pydantic models).
- Resolves/downloads the base GLB (supports http(s) signed URLs or local paths).
- Calls the pure geometry modules (solid_generator + belt_transformer).
- For Phase 1: returns a stub G-code after solid + belt (real Kiri:Moto slicing added in Phase 2).
- Clean error responses.

The geometry functions remain untouched and reusable (CLI, tests, future jobs).
"""

from __future__ import annotations

import os
import tempfile
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.models.requests import GenerateSolidRequest, GrindingStyle
from app.services.belt_transformer import apply_belt_transform
from app.services.presets import get_preset
from app.services.slicer import generate_gcode_from_solid
from app.services.solid_generator import generate_final_solid

app = FastAPI(
    title="OrthoCAD Hybrid Manufacturing Service",
    version="0.1.0",
    description="Authoritative solid generation + belt transform + (future) slicing for orthotic manufacturing.",
)

# In production this would come from a real job queue / object storage.
# For now we keep everything in-memory for the response (G-code can be large but acceptable for MVP).


def _download_to_temp(url_or_path: str) -> str:
    """Download http(s) URL to a temp file or return the path if already local."""
    if url_or_path.startswith(("http://", "https://")):
        with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            with httpx.stream("GET", url_or_path, follow_redirects=True, timeout=60) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes():
                        f.write(chunk)
            return tmp_path
        except Exception as e:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
            raise HTTPException(status_code=400, detail=f"Failed to download base_glb_url: {e}") from e
    else:
        if not os.path.exists(url_or_path):
            raise HTTPException(status_code=400, detail=f"base_glb_path does not exist: {url_or_path}")
        return url_or_path


def _build_grinding_style_dict(style: GrindingStyle) -> dict[str, Any]:
    return {
        "type": style.type,
        "angle_degrees": style.angle_degrees,
        "radius_mm": style.radius_mm,
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "hybrid-manufacturing"}


@app.post("/manufacture")
async def manufacture(req: GenerateSolidRequest) -> JSONResponse:
    """
    Main entry point for the hybrid pipeline (Phase 1 wiring).

    Currently performs:
      1. Resolve base GLB (download if URL).
      2. generate_final_solid (corrections + trimlines + grinding sides).
      3. apply_belt_transform (using belt angle from preset or default 45).
      4. Return a minimal G-code stub (real slicing in Phase 2).

    On any geometry or processing failure we raise a clean HTTP error so the
    Node orchestrator can avoid token deduction.
    """
    # Belt angle comes from the caller (Node resolves from preset / printer profile).
    belt_angle = float(getattr(req, "belt_angle_deg", 45.0) or 45.0)

    # 1. Resolve base
    local_glb = _download_to_temp(req.base_glb_url)

    try:
        # 2. Solid
        solid = generate_final_solid(
            base_glb_path=local_glb,
            corrections=req.corrections,
            trimlines=req.trimlines,
            heel_lift_mm=req.heel_lift_mm,
            heel_cup_width_mm=req.heel_cup_width_mm,
            grinding_style=_build_grinding_style_dict(req.grinding_style),
            thickness_mm=req.thickness_mm,
        )

        # 3. Belt transform
        transformed = apply_belt_transform(solid, belt_angle)

        # 4. Improved Kiri-style slicing (perimeters, solid layers, TPU/belt profiles) on the
        # already belt-transformed solid. Node (not Python) owns storage of the resulting gcode
        # and returns only a productionId + download reference to the client.
        preset = get_preset(req.preset_id)
        # Override with values coming from the request (authoritative for this job)
        preset["beltAngleDeg"] = belt_angle
        overrides: dict[str, Any] = {
            "layerHeightMm": preset.get("layerHeightMm", 0.30),
            "perimeters": preset.get("perimeters", 3),
            "infillDensity": preset.get("infillDensity", 0.15),
        }

        gcode = generate_gcode_from_solid(transformed, preset, overrides)

        # Clean up temp if we downloaded
        if req.base_glb_url.startswith(("http://", "https://")):
            try:
                os.unlink(local_glb)
            except Exception:
                pass

        return JSONResponse(
            {
                "ok": True,
                "job_id": req.job_id,
                "design_id": req.design_id,
                "preset_id": req.preset_id,
                "belt_angle_deg": belt_angle,
                "grinding_style": req.grinding_style.type,
                "gcode": gcode,
            }
        )

    except Exception as e:
        # Important: do NOT let the Node deduct tokens on failure.
        if req.base_glb_url.startswith(("http://", "https://")):
            try:
                os.unlink(local_glb)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Manufacturing failed: {str(e)}") from e


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=True)
