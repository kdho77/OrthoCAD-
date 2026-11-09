# Minimal Dockerfile for the OrthoCAD hybrid manufacturing Python service
FROM python:3.11-slim

WORKDIR /app

# System deps for trimesh (some optional backends)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# print_recipe.py opens this path at import (parents[3] of
# /app/app/services/print_recipe.py is "/"). The build context is
# python-service, so the monorepo file vertex/shared/print-recipe/
# hardness-to-infill-pct.json is packaged beside this Dockerfile and
# copied to the path the process already uses. Percentages are unchanged.
COPY shared/print-recipe/hardness-to-infill-pct.json /vertex/shared/print-recipe/hardness-to-infill-pct.json

# Railway routes to $PORT and marks the deploy failed when nothing listens there.
# A fixed 8001 leaves the public host unpublished, so POST /manufacture is a platform 404.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
