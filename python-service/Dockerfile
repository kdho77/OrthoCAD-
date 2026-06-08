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

# Default command runs the FastAPI service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
