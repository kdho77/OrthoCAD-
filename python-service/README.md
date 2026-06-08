# Vertex Manufacturing Service (Phase 1)

Python microservice for the hybrid slicing and G-code pipeline. Phase 1 provides API contracts, routing, authentication, and stub geometry orchestration — **no core geometry logic yet**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `POST` | `/api/v1/manufacturing/generate-solid` | Generate a manufacturing solid (stub) |

## Authentication

Internal service-to-service calls must send:

```
Authorization: Bearer <MANUFACTURING_INTERNAL_API_KEY>
```

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `MANUFACTURING_INTERNAL_API_KEY` | Shared secret for Node → Python auth | `dev-manufacturing-key` |
| `PORT` | HTTP port | `8000` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `*` |

## Local development

```bash
cd python-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export MANUFACTURING_INTERNAL_API_KEY=dev-manufacturing-key
uvicorn app.main:app --reload --port 8000
```

## Docker

```bash
docker build -t vertex-manufacturing .
docker run -p 8000:8000 -e MANUFACTURING_INTERNAL_API_KEY=dev-manufacturing-key vertex-manufacturing
```

## Out of scope (later phases)

- `solid_generator.py` — watertight solid generation
- `belt_transformer.py` — belt grinding transform
