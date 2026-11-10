#!/bin/bash
# Notarize and staple the macOS package. Exits without changing the package when the org credentials are absent.
set -euo pipefail
PKG="${1:-print-bridge/packaging/dist/OrthoCAD-Print-Bridge.pkg}"
if [ -z "${ORTHOCAD_APPLE_ID:-}" ] || [ -z "${ORTHOCAD_APPLE_TEAM_ID:-}" ] || [ -z "${ORTHOCAD_APPLE_APP_PASSWORD_FILE:-}" ]; then
    echo "Notarization skipped. Set ORTHOCAD_APPLE_ID, ORTHOCAD_APPLE_TEAM_ID, and ORTHOCAD_APPLE_APP_PASSWORD_FILE when the Apple credentials are ready."
    exit 0
fi
if [ ! -f "$PKG" ]; then
    echo "Package not found: $PKG" >&2
    exit 1
fi
xcrun notarytool submit "$PKG" \
    --apple-id "$ORTHOCAD_APPLE_ID" \
    --team-id "$ORTHOCAD_APPLE_TEAM_ID" \
    --password "$(cat "$ORTHOCAD_APPLE_APP_PASSWORD_FILE")" \
    --wait
xcrun stapler staple "$PKG"
echo "Notarized $PKG"
