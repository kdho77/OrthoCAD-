# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

from typing import Any, Literal, Optional

from pydantic import BaseModel


class ManufactureResponse(BaseModel):
    """Response from POST /manufacture."""

    ok: bool = True
    job_id: str
    design_id: str
    preset_id: str
    output_type: Literal["gcode", "stl"]
    belt_angle_deg: Optional[float] = None
    grinding_style: Optional[str] = None
    gcode: Optional[str] = None
    stl_base64: Optional[str] = None
    metadata: dict[str, Any] = {}
