from typing import Annotated

from fastapi import Depends

from app.core.security import verify_internal_api_key

InternalServiceAuth = Annotated[None, Depends(verify_internal_api_key)]
