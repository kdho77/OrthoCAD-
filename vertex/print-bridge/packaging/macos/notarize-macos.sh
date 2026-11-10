#!/bin/bash
# Sign, notarize, staple, and check the macOS print bridge.
# Developer ID Application signs the embedded Node, the .app, and the .dmg.
# Developer ID Installer signs the .pkg.
# Notarization uses an App Store Connect API key when those secrets exist,
# and otherwise an Apple ID plus an app-specific password.
# When the Developer ID secrets are absent, this script changes nothing and exits 0.
# It does not print P12 bytes, the .p8 key, or certificate passwords.
set +x
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENTITLEMENTS="$HERE/entitlements.plist"
KEYCHAIN="${ORTHOCAD_MACOS_KEYCHAIN_PATH:-${RUNNER_TEMP:-/tmp}/orthocad-print-bridge.keychain-db}"
PASS_FILE="${RUNNER_TEMP:-/tmp}/orthocad-keychain.password"
APP_P12="${RUNNER_TEMP:-/tmp}/orthocad-devid-app.p12"
INSTALLER_P12="${RUNNER_TEMP:-/tmp}/orthocad-devid-installer.p12"
P8_FILE="${RUNNER_TEMP:-/tmp}/AuthKey_orthocad.p8"
APPLE_PASS_FILE="${RUNNER_TEMP:-/tmp}/orthocad-apple-app.password"
IDENTITY_FILE="${RUNNER_TEMP:-/tmp}/orthocad-signing-identities.env"
DIST="${ORTHOCAD_MACOS_DIST:-}"

write_status() {
    if [ -n "$DIST" ]; then
        printf '%s\n' "$1" > "$DIST/signing-status.txt"
    fi
}

signing_names_missing() {
    local missing=""
    [ -z "${ORTHOCAD_MACOS_DEVID_APP_P12_BASE64:-}" ] && missing="$missing ORTHOCAD_MACOS_DEVID_APP_P12_BASE64"
    [ -z "${ORTHOCAD_MACOS_DEVID_INSTALLER_P12_BASE64:-}" ] && missing="$missing ORTHOCAD_MACOS_DEVID_INSTALLER_P12_BASE64"
    [ -z "${ORTHOCAD_MACOS_P12_PASSWORD:-}" ] && missing="$missing ORTHOCAD_MACOS_P12_PASSWORD"
    [ -z "${ORTHOCAD_APPLE_TEAM_ID:-}" ] && missing="$missing ORTHOCAD_APPLE_TEAM_ID"
    printf '%s' "${missing# }"
}

require_signing_or_skip() {
    local missing
    missing="$(signing_names_missing)"
    if [ -z "$missing" ]; then
        return 0
    fi
    # All four absent: build the unsigned installer. A partial set is a broken secret configuration.
    if [ "$missing" = "ORTHOCAD_MACOS_DEVID_APP_P12_BASE64 ORTHOCAD_MACOS_DEVID_INSTALLER_P12_BASE64 ORTHOCAD_MACOS_P12_PASSWORD ORTHOCAD_APPLE_TEAM_ID" ]; then
        write_status "unsigned"
        echo "macOS signing skipped. Developer ID secrets are absent. The installer will be marked SHORT-UNSIGNED."
        return 1
    fi
    echo "macOS signing secrets are incomplete: $missing" >&2
    exit 1
}

load_identities() {
    if [ ! -f "$IDENTITY_FILE" ]; then
        echo "The temporary keychain has no Developer ID identities. Run prepare first." >&2
        exit 1
    fi
    # shellcheck disable=SC1090
    source "$IDENTITY_FILE"
    if [ -z "${APP_IDENTITY:-}" ] || [ -z "${INSTALLER_IDENTITY:-}" ]; then
        echo "Developer ID identities were not recorded." >&2
        exit 1
    fi
}

cmd_prepare() {
    if ! require_signing_or_skip; then
        return 0
    fi
    umask 077
    openssl rand -base64 32 > "$PASS_FILE"
    chmod 600 "$PASS_FILE"
    local keychain_password
    keychain_password="$(cat "$PASS_FILE")"
    security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
    security create-keychain -p "$keychain_password" "$KEYCHAIN"
    security set-keychain-settings -lut 21600 "$KEYCHAIN"
    security unlock-keychain -p "$keychain_password" "$KEYCHAIN"
    security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')

    printf '%s' "$ORTHOCAD_MACOS_DEVID_APP_P12_BASE64" | openssl base64 -d -A -out "$APP_P12"
    chmod 600 "$APP_P12"
    security import "$APP_P12" -k "$KEYCHAIN" -P "$ORTHOCAD_MACOS_P12_PASSWORD" -A -t cert -f pkcs12 \
        -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/security
    rm -f "$APP_P12"

    printf '%s' "$ORTHOCAD_MACOS_DEVID_INSTALLER_P12_BASE64" | openssl base64 -d -A -out "$INSTALLER_P12"
    chmod 600 "$INSTALLER_P12"
    security import "$INSTALLER_P12" -k "$KEYCHAIN" -P "$ORTHOCAD_MACOS_P12_PASSWORD" -A -t cert -f pkcs12 \
        -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/security
    rm -f "$INSTALLER_P12"

    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$KEYCHAIN" >/dev/null

    local app_identity installer_identity
    app_identity="$(security find-identity -v -p codesigning "$KEYCHAIN" | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | sed -n '1p')"
    installer_identity="$(security find-identity -v "$KEYCHAIN" | sed -n 's/.*"\(Developer ID Installer:[^"]*\)".*/\1/p' | sed -n '1p')"
    if [ -z "$app_identity" ] || [ -z "$installer_identity" ]; then
        echo "The temporary keychain is missing a Developer ID Application or Developer ID Installer certificate." >&2
        exit 1
    fi
    case "$app_identity" in
        *"($ORTHOCAD_APPLE_TEAM_ID)"*) ;;
        *)
            echo "The Developer ID Application certificate does not match ORTHOCAD_APPLE_TEAM_ID." >&2
            exit 1
            ;;
    esac
    case "$installer_identity" in
        *"($ORTHOCAD_APPLE_TEAM_ID)"*) ;;
        *)
            echo "The Developer ID Installer certificate does not match ORTHOCAD_APPLE_TEAM_ID." >&2
            exit 1
            ;;
    esac
    printf 'APP_IDENTITY=%q\nINSTALLER_IDENTITY=%q\n' "$app_identity" "$installer_identity" > "$IDENTITY_FILE"
    chmod 600 "$IDENTITY_FILE"
    echo "Imported Developer ID certificates into the temporary keychain."
}

sign_macho() {
    local target="$1"
    codesign --force --options runtime --timestamp \
        --identifier "com.orthocad.print-bridge.node" \
        --entitlements "$ENTITLEMENTS" \
        --sign "$APP_IDENTITY" \
        "$target"
    codesign --verify --strict --verbose=2 "$target"
}

cmd_sign_payload() {
    local payload="${1:-}"
    if [ -z "$payload" ]; then
        echo "sign-payload needs the staged PrintBridge directory." >&2
        exit 1
    fi
    if ! require_signing_or_skip; then
        return 0
    fi
    if [ ! -f "$IDENTITY_FILE" ]; then
        cmd_prepare
    fi
    load_identities
    if [ ! -x "$payload/node" ]; then
        echo "The embedded Node binary is missing from the payload." >&2
        exit 1
    fi
    sign_macho "$payload/node"
    local app="$payload/OrthoCADPrintBridge.app"
    if [ -d "$app" ]; then
        if [ -e "$app/Contents/MacOS/node" ]; then
            sign_macho "$app/Contents/MacOS/node"
        fi
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS" \
            --sign "$APP_IDENTITY" \
            "$app"
        codesign --verify --strict --verbose=2 "$app"
    fi
    echo "Signed the embedded Node and app bundle with Developer ID Application."
}

cmd_productsign() {
    local pkg="${1:-}"
    if [ -z "$pkg" ] || [ ! -f "$pkg" ]; then
        echo "productsign needs the built .pkg." >&2
        exit 1
    fi
    if ! require_signing_or_skip; then
        return 0
    fi
    load_identities
    local signed="${pkg}.signed"
    productsign --sign "$INSTALLER_IDENTITY" "$pkg" "$signed"
    mv "$signed" "$pkg"
    pkgutil --check-signature "$pkg"
    write_status "signed"
    echo "Signed the package with Developer ID Installer."
}

cmd_sign_disk_image() {
    local dmg="${1:-}"
    if [ -z "$dmg" ] || [ ! -f "$dmg" ]; then
        echo "sign-disk-image needs the built .dmg." >&2
        exit 1
    fi
    if ! require_signing_or_skip; then
        return 0
    fi
    load_identities
    codesign --force --timestamp --sign "$APP_IDENTITY" "$dmg"
    codesign --verify --verbose=2 "$dmg"
    echo "Signed the disk image with Developer ID Application."
}

submit_for_notarization() {
    local artifact="$1"
    local asc_missing=""
    [ -z "${ORTHOCAD_ASC_API_KEY_P8_BASE64:-}" ] && asc_missing="$asc_missing ORTHOCAD_ASC_API_KEY_P8_BASE64"
    [ -z "${ORTHOCAD_ASC_API_KEY_ID:-}" ] && asc_missing="$asc_missing ORTHOCAD_ASC_API_KEY_ID"
    [ -z "${ORTHOCAD_ASC_API_ISSUER_ID:-}" ] && asc_missing="$asc_missing ORTHOCAD_ASC_API_ISSUER_ID"
    asc_missing="${asc_missing# }"
    if [ -z "$asc_missing" ]; then
        umask 077
        printf '%s' "$ORTHOCAD_ASC_API_KEY_P8_BASE64" | openssl base64 -d -A -out "$P8_FILE"
        chmod 600 "$P8_FILE"
        xcrun notarytool submit "$artifact" \
            --key "$P8_FILE" \
            --key-id "$ORTHOCAD_ASC_API_KEY_ID" \
            --issuer "$ORTHOCAD_ASC_API_ISSUER_ID" \
            --wait
        rm -f "$P8_FILE"
        return 0
    fi
    if [ "$asc_missing" != "ORTHOCAD_ASC_API_KEY_P8_BASE64 ORTHOCAD_ASC_API_KEY_ID ORTHOCAD_ASC_API_ISSUER_ID" ]; then
        echo "App Store Connect API key secrets are incomplete: $asc_missing" >&2
        exit 1
    fi
    local apple_missing=""
    [ -z "${ORTHOCAD_APPLE_ID:-}" ] && apple_missing="$apple_missing ORTHOCAD_APPLE_ID"
    [ -z "${ORTHOCAD_APPLE_APP_PASSWORD:-}" ] && apple_missing="$apple_missing ORTHOCAD_APPLE_APP_PASSWORD"
    apple_missing="${apple_missing# }"
    if [ -z "$apple_missing" ]; then
        umask 077
        printf '%s' "$ORTHOCAD_APPLE_APP_PASSWORD" > "$APPLE_PASS_FILE"
        chmod 600 "$APPLE_PASS_FILE"
        xcrun notarytool submit "$artifact" \
            --apple-id "$ORTHOCAD_APPLE_ID" \
            --team-id "$ORTHOCAD_APPLE_TEAM_ID" \
            --password "$(cat "$APPLE_PASS_FILE")" \
            --wait
        rm -f "$APPLE_PASS_FILE"
        return 0
    fi
    if [ -n "$apple_missing" ] && [ "$apple_missing" != "ORTHOCAD_APPLE_ID ORTHOCAD_APPLE_APP_PASSWORD" ]; then
        echo "Apple ID notarization secrets are incomplete: $apple_missing" >&2
        exit 1
    fi
    return 2
}

cmd_notarize() {
    local pkg="${1:-}"
    local dmg="${2:-}"
    if ! require_signing_or_skip; then
        return 0
    fi
    if [ -z "$pkg" ] || [ ! -f "$pkg" ]; then
        echo "notarize needs the signed .pkg." >&2
        exit 1
    fi
    set +e
    submit_for_notarization "$pkg"
    local pkg_status=$?
    set -e
    if [ "$pkg_status" -eq 2 ]; then
        echo "Notarization skipped. Set ORTHOCAD_ASC_API_KEY_P8_BASE64, ORTHOCAD_ASC_API_KEY_ID, and ORTHOCAD_ASC_API_ISSUER_ID, or ORTHOCAD_APPLE_ID and ORTHOCAD_APPLE_APP_PASSWORD."
        write_status "signed"
        return 0
    fi
    if [ "$pkg_status" -ne 0 ]; then
        exit "$pkg_status"
    fi
    xcrun stapler staple "$pkg"
    if [ -n "$dmg" ] && [ -f "$dmg" ]; then
        submit_for_notarization "$dmg"
        xcrun stapler staple "$dmg"
    fi
    xcrun stapler validate "$pkg"
    spctl --assess --verbose=4 --type install "$pkg"
    if [ -n "$dmg" ] && [ -f "$dmg" ]; then
        xcrun stapler validate "$dmg"
        spctl --assess --verbose=4 --type open --context context:primary-signature "$dmg"
    fi
    write_status "notarized"
    echo "Notarized, stapled, and verified the macOS installer."
}

cmd_cleanup() {
    security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
    rm -f "$PASS_FILE" "$APP_P12" "$INSTALLER_P12" "$P8_FILE" "$APPLE_PASS_FILE" "$IDENTITY_FILE"
    echo "Deleted the temporary signing keychain."
}

usage() {
    echo "Usage: notarize-macos.sh prepare|sign-payload <dir>|productsign <pkg>|sign-disk-image <dmg>|notarize <pkg> [dmg]|cleanup" >&2
    exit 1
}

command="${1:-}"
case "$command" in
    prepare) cmd_prepare ;;
    sign-payload) cmd_sign_payload "${2:-}" ;;
    productsign) cmd_productsign "${2:-}" ;;
    sign-disk-image) cmd_sign_disk_image "${2:-}" ;;
    notarize) cmd_notarize "${2:-}" "${3:-}" ;;
    cleanup) cmd_cleanup ;;
    "") usage ;;
    *)
        # A bare package path stays a notarization request.
        if [ -f "$command" ]; then
            cmd_notarize "$command" "${2:-}"
        else
            usage
        fi
        ;;
esac
