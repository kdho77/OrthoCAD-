#!/bin/bash
# Build the macOS package and disk image. The shop user does not run this.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIST="$HERE/../dist"
VER="$(node -p "process.versions.node")"
WORKDIR="$(mktemp -d)"
curl -fsSL -o "$WORKDIR/arm64.tar.gz" "https://nodejs.org/dist/v${VER}/node-v${VER}-darwin-arm64.tar.gz"
curl -fsSL -o "$WORKDIR/x64.tar.gz" "https://nodejs.org/dist/v${VER}/node-v${VER}-darwin-x64.tar.gz"
mkdir -p "$WORKDIR/arm64" "$WORKDIR/x64" "$DIST"
tar -xzf "$WORKDIR/arm64.tar.gz" -C "$WORKDIR/arm64" --strip-components=1
tar -xzf "$WORKDIR/x64.tar.gz" -C "$WORKDIR/x64" --strip-components=1
lipo -create "$WORKDIR/arm64/bin/node" "$WORKDIR/x64/bin/node" -output "$DIST/node-universal"
chmod 755 "$DIST/node-universal"
export ORTHOCAD_MACOS_DIST="$DIST"
printf '%s\n' "unsigned" > "$DIST/signing-status.txt"
bash "$HERE/notarize-macos.sh" prepare
bash "$HERE/build-pkg.sh"
bash "$HERE/notarize-macos.sh" productsign "$DIST/OrthoCAD-Print-Bridge.pkg"
DMG_STAGE="$(mktemp -d)"
cp "$DIST/OrthoCAD-Print-Bridge.pkg" "$DMG_STAGE/"
hdiutil create -volname "OrthoCAD Print Bridge" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DIST/OrthoCAD-Print-Bridge.dmg"
bash "$HERE/notarize-macos.sh" sign-disk-image "$DIST/OrthoCAD-Print-Bridge.dmg"
bash "$HERE/notarize-macos.sh" notarize "$DIST/OrthoCAD-Print-Bridge.pkg" "$DIST/OrthoCAD-Print-Bridge.dmg"
rm -rf "$WORKDIR" "$DMG_STAGE"
echo "Built OrthoCAD-Print-Bridge.pkg and OrthoCAD-Print-Bridge.dmg"
