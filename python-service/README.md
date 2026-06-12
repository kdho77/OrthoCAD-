# Vertex Manufacturing Service

Python microservice for the OrthoCAD hybrid manufacturing pipeline. Accepts a finished STL exported from the client viewer, validates watertightness, and returns G-code (Vertex belt/FDM profiles) or the validated STL (external printers).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `POST` | `/manufacture` | Validate STL → G-code or STL output |

## Authentication

Internal service-to-service calls must send:

```
Authorization: Bearer <MANUFACTURING_INTERNAL_API_KEY>
```

When `MANUFACTURING_INTERNAL_API_KEY` is unset (local dev), auth is skipped.

## Request (`POST /manufacture`)

| Field | Description |
|-------|-------------|
| `stl_url` | HTTP(S) URL of the finished STL uploaded by the client |
| `output_type` | `"gcode"` or `"stl"` |
| `preset_id` | Client printer preset id (normalized server-side) |
| `belt_angle_deg` | Belt angle from the client preset |
| `layer_height_mm` | Optional UI override |
| `infill_density` | Optional UI override (0–1) |
| `perimeters` | Optional UI override |
| `side` | `"left"` or `"right"` (metadata) |

Unknown `preset_id` values with `output_type=gcode` fall back to STL passthrough.

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `MANUFACTURING_INTERNAL_API_KEY` | Shared secret for Node → Python auth | (unset in dev) |
| `PORT` | HTTP port | `8001` |

## Local development

```bash
cd python-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export MANUFACTURING_INTERNAL_API_KEY=dev-manufacturing-key
uvicorn app.main:app --reload --port 8001
```

## Pipeline modules

| Module | Role |
|--------|------|
| `stl_loader.py` | Download STL, validate/repair watertightness |
| `belt_transformer.py` | 3D belt pre-transform before planar slicing |
| `slicer.py` | Planar layer slicing + G-code emission |
| `presets.py` | Server-side printer profiles + client ID aliases |

`solid_generator.py` remains for tests and legacy tooling but is not used by `/manufacture`.
