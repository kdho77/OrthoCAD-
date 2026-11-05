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

# Railway routes to $PORT and marks the deploy failed when nothing listens there.
# A fixed 8001 leaves the public host unpublished, so POST /manufacture is a platform 404.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
