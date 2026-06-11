# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Pydantic models for the hybrid manufacturing pipeline (STL-in → G-code or STL-out).
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class GrindingStyle(BaseModel):
    """Optional metadata carried for audit; geometry is supplied as STL."""

    type: Literal["straight", "rounded"]
    angle_degrees: Optional[float] = None
    radius_mm: Optional[float] = None


class GenerateSolidRequest(BaseModel):
    """Manufacturing request: finished STL from the client viewer."""

    job_id: str
    design_id: str
    preset_id: str
    stl_url: str
    output_type: Literal["gcode", "stl"] = "gcode"
    belt_angle_deg: float = 45.0
    side: str | None = None  # "left" | "right"
    layer_height_mm: float | None = None
    infill_density: float | None = None
    perimeters: int | None = None
    grinding_style: GrindingStyle | None = None
