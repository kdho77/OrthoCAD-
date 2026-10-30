# OrthoCAD

Proprietary orthotic insole CAD from Vertex Orthopedic. The browser app and API
live in [`vertex/`](vertex/README.md). The hybrid manufacturing service lives in
[`python-service/`](python-service/README.md).

This repository is not the Chili3D project and does not grant the GNU Affero
General Public License. See [`LICENSE`](LICENSE). The copyright notice is
pending counsel review.

Provenance for files that carried a Chili3D banner, and for the removed
Chili3D monorepo trees, is recorded in
[`docs/license-classification.md`](docs/license-classification.md).

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

## Third-party licenses

Dependency and font licenses stay with their authors. The list is in
[`LICENSE`](LICENSE) and [`docs/license-classification.md`](docs/license-classification.md).
