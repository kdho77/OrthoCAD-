from typing import Literal, Optional

from pydantic import BaseModel


class GrindingStyle(BaseModel):
    type: Literal["straight", "rounded"]
    angle_degrees: Optional[float] = None
    radius_mm: Optional[float] = None


class GenerateSolidRequest(BaseModel):
    job_id: str
    design_id: str
    preset_id: str
    base_glb_url: str
    corrections: dict
    trimlines: dict
    heel_lift_mm: float = 0.0
    heel_cup_width_mm: float = 0.0
    grinding_style: GrindingStyle
    thickness_mm: float
