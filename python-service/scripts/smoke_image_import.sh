#!/usr/bin/env bash
# Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
#
# Build the python-service image and prove import of the FastAPI app no longer
# raises FileNotFoundError for the hardness table, and that /health succeeds.
#
# Run from anywhere:
#   python-service/scripts/smoke_image_import.sh

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

canonical="../vertex/shared/print-recipe/hardness-to-infill-pct.json"
packaged="shared/print-recipe/hardness-to-infill-pct.json"
cmp -s "$canonical" "$packaged"

if docker info >/dev/null 2>&1; then
    docker() { command docker "$@"; }
elif sudo docker info >/dev/null 2>&1; then
    docker() { sudo docker "$@"; }
else
    echo "docker is required to smoke-test the packaged image" >&2
    exit 1
fi

image="orthocad-python-service:hardness-smoke"
docker build -t "$image" "$root"

docker run --rm --entrypoint python "$image" -c \
    "from pathlib import Path; from app.main import app; p = Path('/vertex/shared/print-recipe/hardness-to-infill-pct.json'); assert p.is_file(), p; assert app.title; print('import-ok', p)"

name="orthocad-mfg-health-$$"
docker rm -f "$name" >/dev/null 2>&1 || true
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" -e PORT=8001 -p 18001:8001 "$image" >/dev/null

ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if curl -fsS "http://127.0.0.1:18001/health"; then
        echo
        ok=1
        break
    fi
    sleep 1
done

if [[ "$ok" -ne 1 ]]; then
    docker logs "$name" >&2 || true
    echo "GET /health did not succeed" >&2
    exit 1
fi
