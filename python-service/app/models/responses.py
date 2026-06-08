from typing import Optional

from pydantic import BaseModel


class GenerateSolidResponse(BaseModel):
    job_id: str
    solid_stl_base64: Optional[str] = None
    solid_url: Optional[str] = None
    metadata: dict
