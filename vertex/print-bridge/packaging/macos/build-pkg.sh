#!/bin/bash
# Build a notarization-ready universal macOS package on a Mac.
# This script does not notarize. See notarize-macos.sh after the org certificate is available.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STAGE="$(mktemp -d)"
APP="$STAGE/Library/Application Support/OrthoCAD/PrintBridge"
mkdir -p "$APP/state"
cp "$ROOT/print-bridge/packaging/dist/bridge.mjs" "$APP/bridge.mjs"
cp "$ROOT/print-bridge/packaging/macos/com.orthocad.print-bridge.plist" "$APP/com.orthocad.print-bridge.plist"
cp "$ROOT/print-bridge/packaging/macos/keychain-store.swift" "$APP/keychain-store.swift"
if [ -x "$ROOT/print-bridge/packaging/dist/node-universal" ]; then
    cp "$ROOT/print-bridge/packaging/dist/node-universal" "$APP/node"
    chmod 755 "$APP/node"
else
    echo "Place a universal (arm64+x64) node binary at print-bridge/packaging/dist/node-universal before building the package." >&2
    exit 1
fi
chmod 755 "$ROOT/print-bridge/packaging/macos/scripts/postinstall"
pkgbuild \
    --root "$STAGE" \
    --scripts "$ROOT/print-bridge/packaging/macos/scripts" \
    --identifier com.orthocad.print-bridge \
    --version 2026.11.10.1 \
    --install-location / \
    "$ROOT/print-bridge/packaging/dist/OrthoCAD-Print-Bridge.pkg"
rm -rf "$STAGE"
echo "Built OrthoCAD-Print-Bridge.pkg. Notarize it with packaging/macos/notarize-macos.sh."
