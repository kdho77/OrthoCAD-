# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Minimal Pydantic models for the Phase 1 solid generation pipeline.
Bootstrap only — consumed internally by solid_generator / belt_transformer.
No HTTP surface or routers.
"""

from pydantic import BaseModel
from typing import Literal, Optional, Any


class GrindingStyle(BaseModel):
    """Grinding style specification for side wall generation."""
    type: Literal["straight", "rounded"]
    angle_degrees: Optional[float] = None  # required/used only for type == "straight"
    radius_mm: Optional[float] = None      # required/used only for type == "rounded"


class GenerateSolidRequest(BaseModel):
    """Internal request shape for final solid generation (manufacturing path)."""
    job_id: str
    design_id: str
    preset_id: str
    base_glb_url: str
    corrections: dict[str, Any]           # See correction fidelity requirement in prompt
    trimlines: dict[str, Any]             # Per-side (or current side) closed polyline data
    heel_lift_mm: float = 0.0
    heel_cup_width_mm: float = 0.0
    grinding_style: GrindingStyle
    thickness_mm: float

    # Extension fields for full manufacturing (belt angle comes from preset on the Node side)
    belt_angle_deg: float = 45.0
    side: str | None = None  # "left" | "right" - used for medialSign in height field if needed
