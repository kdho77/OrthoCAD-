# Print bridge installers

Shop computers install the print bridge by opening a file. Nobody types a command, opens Terminal, or pastes a proof.

The bridge still dials OrthoCAD over outbound HTTPS and then talks to Moonraker on the shop LAN. It does not listen for inbound printer traffic.

## What the shop does

1. On Production, Printers, download the installer for this computer. Windows opens `OrthoCAD-Print-Bridge-Setup.exe`. Mac opens `OrthoCAD-Print-Bridge.pkg` (or the disk image).
2. The installer starts the bridge immediately. Windows registers a service that starts at boot. Mac registers a LaunchAgent that starts at login.
3. The bridge opens the Printers page with a short pairing code. An admin enters that code and approves the computer.
4. Add a printer from the discovered list, or type an address in Configure Moonraker printer. The connection test is `GET /server/info` only.

Already-enrolled bridges keep working. If a plaintext `credential` file and a bridge id (`bridge.json`, `bridge-id`, or Task Scheduler XML with `ORTHOCAD_BRIDGE_ID`) are in the state directory, the installer copies the credential into Windows DPAPI or the macOS Keychain and deletes the file. It does not show the credential and does not require pairing again.

## Where credentials live

- Windows: DPAPI LocalMachine ciphertext written by `packaging/windows/dpapi-store.ps1`. The secret is read from stdin and is not a script argument.
- macOS: the login Keychain item `orthocad-print-bridge`, written by `packaging/macos/keychain-store.swift` from stdin.
- The server stores only `credentialHash` and `proofHash`. Pairing codes are stored as sha256. The short code is not a credential.

Do not log proofs, credentials, Moonraker API keys, or signing private keys.

## Required secrets

These names are repository or organization secrets. None of them are committed.

- `ORTHOCAD_AUTHENTICODE_THUMBPRINT` — Windows Authenticode. When it is absent, the Windows job still uploads `OrthoCAD-Print-Bridge-Setup.exe` and adds `SHORT-UNSIGNED.txt`.
- `ORTHOCAD_MACOS_DEVID_APP_P12_BASE64` — Developer ID Application certificate, base64 PKCS#12. `codesign` uses it for the embedded Node binary, the `.app`, and the `.dmg`.
- `ORTHOCAD_MACOS_DEVID_INSTALLER_P12_BASE64` — Developer ID Installer certificate, base64 PKCS#12. `productsign` uses it for the `.pkg`.
- `ORTHOCAD_MACOS_P12_PASSWORD` — password for both PKCS#12 files.
- `ORTHOCAD_APPLE_TEAM_ID` — Apple team id on both Developer ID certificates.
- `ORTHOCAD_ASC_API_KEY_P8_BASE64`, `ORTHOCAD_ASC_API_KEY_ID`, `ORTHOCAD_ASC_API_ISSUER_ID` — App Store Connect API key. This is the preferred notarization path (`xcrun notarytool submit --key`). The workflow does not print the `.p8`.
- `ORTHOCAD_APPLE_ID` and `ORTHOCAD_APPLE_APP_PASSWORD` — notarization fallback, together with `ORTHOCAD_APPLE_TEAM_ID`, when the API key secrets are absent.
- `ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY` — Ed25519 private key PEM for the update manifest. The release job writes it to a temporary file, passes `ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE`, then deletes the file. When the secret is absent, the manifest is published unsigned and the log says signing was skipped. When the secret is present and `update-public-keys.json` still contains `REPLACE-WITH-PRODUCTION-PUBLIC-KEY`, the release job refuses to publish.

When the four Developer ID secrets are absent, the macOS job still uploads `OrthoCAD-Print-Bridge.pkg` and `OrthoCAD-Print-Bridge.dmg` and adds `SHORT-UNSIGNED.txt`. A partial set fails the job. The certificates are imported into a temporary keychain that an `always()` step deletes. Passwords, P12 bytes, and the `.p8` are not written to the log.

Release and CI installer builds set `ORTHOCAD_BRIDGE_CLOUD_ORIGIN=https://orthocad.vertexorthopedic.com` and `ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL=https://github.com/kdho77/OrthoCAD-/releases/latest/download/update-manifest.json`. Those values are copied into `cloud-origin.txt` and `update-manifest-url.txt` beside the bridge. A shop install reads those files on first run. Local development can still override either value in the environment.

## What this repository builds on Linux

`node print-bridge/packaging/check-packaging.mjs` bundles `bridge.mjs` and `prepare-config.mjs` with esbuild and checks the installer scripts. It signs a throwaway update manifest with an ephemeral key and deletes that key. It does not produce a signed `.exe` or a notarized `.pkg`.

## Windows signing pass

On a Windows machine, with Inno Setup 6 and a WinSW `OrthoCADPrintBridge.exe` next to `packaging/windows/OrthoCADPrintBridge.xml`:

1. Set `ORTHOCAD_BRIDGE_CLOUD_ORIGIN` to the same https origin as the server's `ORTHOCAD_CLOUD_ORIGIN`.
2. Place a Node 22 x64 `node.exe` in the payload `node` folder. Shops do not install Node themselves.
3. Run `node print-bridge/packaging/build-payload.mjs` and copy `dist/*.cjs` plus `dpapi-store.ps1` into the Inno payload.
4. Compile `packaging/windows/orthocad-print-bridge.iss`.
5. Sign with `packaging/windows/sign-authenticode.ps1` after `ORTHOCAD_AUTHENTICODE_THUMBPRINT` is set. Without that variable the script skips signing.

Publish `OrthoCAD-Print-Bridge-Setup.exe` on the GitHub release named by the download button.

## macOS signing and notarization

`print-bridge/packaging/macos/build-release.sh` builds the universal Node binary, the package, and the disk image. `notarize-macos.sh` then:

1. Imports the Developer ID P12s into a temporary keychain.
2. `codesign`s the embedded Node and `OrthoCADPrintBridge.app` with Developer ID Application, the hardened runtime, and `entitlements.plist` (JIT, unsigned executable memory, and library validation disabled so the embedded Node can run).
3. `productsign`s the `.pkg` with Developer ID Installer.
4. `codesign`s the `.dmg` with Developer ID Application.
5. Notarizes with `xcrun notarytool submit --key` when the App Store Connect API key secrets are present. Otherwise it uses `--apple-id` and the app-specific password.
6. Staples the `.pkg` and `.dmg`, then checks them with `xcrun stapler validate` and `spctl --assess`.

Without the Developer ID secrets, those steps are skipped and the workflow writes `SHORT-UNSIGNED.txt`. The package job does not fail only because those secrets are missing.

Publish `OrthoCAD-Print-Bridge.pkg` and `OrthoCAD-Print-Bridge.dmg`.

## Signed auto-update

Installed bridges read `updateManifestUrl` from `bridge.json`. Release and CI builds bake `https://github.com/kdho77/OrthoCAD-/releases/latest/download/update-manifest.json`. A manifest is accepted only when the Ed25519 signature matches a trusted public key, the manifest is unexpired, and the version is newer than the installed version. Unsigned, tampered, expired, and downgrade manifests are ignored.

The public key for key id `orthocad-print-bridge` is committed in `packaging/update-public-keys.json` and copied into both installer payloads. Do not commit the private key. The release job reads it from `ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY` through a temporary file. `guard-update-release.mjs` refuses to publish when that secret is set and the public key file still contains `REPLACE-WITH-PRODUCTION-PUBLIC-KEY`.

On Windows, first run queries the existing OrthoCAD bridge scheduled task with `schtasks /Query` and `schtasks /Query /XML`. A custom `ORTHOCAD_BRIDGE_STATE_DIR` in that XML is imported before the installer falls back to pairing. The credential is copied into DPAPI and the plaintext file is deleted. The old task is disabled.

The current installed version is `2026.11.10.1` in `vertex/shared/print-bridge-version.ts`. That build includes per-printer Moonraker status from the bridge check-in. An older installed bridge picks it up from the next accepted manifest. It does not need a manual relay update.

## Legacy command-line entry

`vertex/print-bridge/main.ts` remains for development and for an already enrolled computer that still starts from the environment. `runBridgeSession` still defaults to one cycle so unit tests stay bounded. The installed service loops that call itself. The product path is the installer, not the command line.
