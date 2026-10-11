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

# AppSail injects X_ZOHO_CATALYST_LISTEN_PORT (default 9000) and kills the
# instance if nothing is bound within 10s. Local docker still defaults to 8001.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${X_ZOHO_CATALYST_LISTEN_PORT:-${PORT:-8001}}"]
