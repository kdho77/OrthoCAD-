# OrthoCAD

Proprietary orthotic insole CAD from Vertex Orthopedic. The browser app and API
live in [`vertex/`](vertex/README.md). The hybrid manufacturing service lives in
[`python-service/`](python-service/README.md).

## Layout

| Path | What it is |
| --- | --- |
| `vertex/` | React/Vite app, tRPC API, geometry, tests under `vertex/tests` |
| `python-service/` | FastAPI manufacturing service (STL validation, belt transform, slicing) |
| `tests/` | Orthotic geometry tests run by the root `rstest` harness |
| `docs/license-classification.md` | Per-file license classification |

## Tests

```bash
npm install
npm install --prefix vertex
npm test
```

Python service:

```bash
pip install -r python-service/requirements.txt
cd python-service && python -m unittest discover -s tests -p 'test_*.py'
python -m unittest test_print_recipe_gyroid.py
```

## License

OrthoCAD is proprietary software owned by Vertex Orthopedic. See
[`LICENSE`](LICENSE). Third-party components are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
