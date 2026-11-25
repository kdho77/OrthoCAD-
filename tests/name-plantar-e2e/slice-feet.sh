#!/usr/bin/env bash
# Slice both manufacturing STLs through the real VertexSlice server.
# usage: slice-feet.sh IMAGE STL_DIR GCODE_DIR
# IMAGE is a docker ref. The gateway-timeout overlay matches
# VertexSlice validation/seam_fuse_gates/slice_all.sh: it only lengthens the
# wait. It does not change G-code. The repo image and production are not modified.
set -euo pipefail
IMAGE=${1:?image}
STL_DIR=${2:?stl dir}
GCODE_DIR=${3:?gcode dir}
if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(sudo docker)
fi
mkdir -p "$GCODE_DIR"
name=name_plantar_slice
port=18091
"${DOCKER[@]}" rm -f "$name" >/dev/null 2>&1 || true
ov="$GCODE_DIR/.overlay"
mkdir -p "$ov"
cid=$("${DOCKER[@]}" create "$IMAGE")
"${DOCKER[@]}" cp "$cid:/app/server/app.py" "$ov/app.py"
"${DOCKER[@]}" rm "$cid" >/dev/null
n=$(grep -c '^SLICE_GATEWAY_TIMEOUT_S = 260$' "$ov/app.py" || true)
if [ "$n" != 1 ]; then
  echo "app.py in $IMAGE does not have exactly one SLICE_GATEWAY_TIMEOUT_S = 260 line ($n); stop"
  exit 3
fi
sed -i 's/^SLICE_GATEWAY_TIMEOUT_S = 260$/SLICE_GATEWAY_TIMEOUT_S = 880  # test-harness overlay only (name-plantar-e2e)/' "$ov/app.py"
"${DOCKER[@]}" run -d --name "$name" -p "$port:8080" -v "$ov/app.py:/app/server/app.py:ro" "$IMAGE" >/dev/null
cleanup() { "${DOCKER[@]}" rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
ok=0
for _ in $(seq 1 90); do
  curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && { ok=1; break; }
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "VertexSlice did not become healthy"
  "${DOCKER[@]}" logs "$name" | tail -30
  exit 1
fi
for side in left right; do
  stl="$STL_DIR/${side}.stl"
  out="$GCODE_DIR/${side}.gcode"
  test -s "$stl"
  t0=$(date +%s)
  code=$(curl -sS -m 900 -w '%{http_code}' -D "$out.hdr" -o "$out" \
    -F profile_id=apex-v2-insole-95a \
    -F "model=@${stl}" \
    -F wall_loops=1 \
    -F infill_density=26 \
    -F print_direction=toe_first \
    -F belt_insole_place=true \
    -F material=apex_core \
    "http://127.0.0.1:$port/v1/slice") || code=000
  bytes=$(stat -c %s "$out" 2>/dev/null || echo 0)
  echo "$side http=$code seconds=$(( $(date +%s) - t0 )) bytes=$bytes"
  if [ "$code" != 200 ] || [ ! -s "$out" ]; then
    echo "slice failed: $side"
    "${DOCKER[@]}" logs "$name" 2>&1 | tail -40
    exit 1
  fi
done
echo SLICES_OK
