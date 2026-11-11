#!/bin/bash
# Build a universal macOS package on a Mac.
# Codesigns the embedded Node when Developer ID secrets are present. Notarization is notarize-macos.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STAGE="$(mktemp -d)"
APP="$STAGE/Library/Application Support/OrthoCAD/PrintBridge"
mkdir -p "$APP/state"
cp "$ROOT/print-bridge/packaging/dist/bridge.mjs" "$APP/bridge.mjs"
cp "$ROOT/print-bridge/packaging/dist/prepare-config.mjs" "$APP/prepare-config.mjs"
cp "$ROOT/print-bridge/packaging/update-public-keys.json" "$APP/update-public-keys.json"
if [ -f "$ROOT/print-bridge/packaging/dist/cloud-origin.txt" ]; then
    cp "$ROOT/print-bridge/packaging/dist/cloud-origin.txt" "$APP/cloud-origin.txt"
fi
if [ -f "$ROOT/print-bridge/packaging/dist/update-manifest-url.txt" ]; then
    cp "$ROOT/print-bridge/packaging/dist/update-manifest-url.txt" "$APP/update-manifest-url.txt"
fi
cp "$ROOT/print-bridge/packaging/macos/com.orthocad.print-bridge.plist" "$APP/com.orthocad.print-bridge.plist"
cp "$ROOT/print-bridge/packaging/macos/keychain-store.swift" "$APP/keychain-store.swift"
if [ -x "$ROOT/print-bridge/packaging/dist/node-universal" ]; then
    cp "$ROOT/print-bridge/packaging/dist/node-universal" "$APP/node"
    chmod 755 "$APP/node"
else
    echo "Place a universal (arm64+x64) node binary at print-bridge/packaging/dist/node-universal before building the package." >&2
    exit 1
fi
APP_BUNDLE="$APP/OrthoCADPrintBridge.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp "$ROOT/print-bridge/packaging/macos/app-info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp "$APP/node" "$APP_BUNDLE/Contents/MacOS/node"
chmod 755 "$APP_BUNDLE/Contents/MacOS/node"
cp "$APP/bridge.mjs" "$APP_BUNDLE/Contents/Resources/bridge.mjs"
bash "$ROOT/print-bridge/packaging/macos/notarize-macos.sh" sign-payload "$APP"
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
