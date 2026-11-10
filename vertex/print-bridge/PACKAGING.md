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

## macOS notarization pass

On a Mac:

1. Build or download a universal Node 22 binary (`arm64` and `x64`) and save it as `print-bridge/packaging/dist/node-universal`. `lipo -create` the two architecture builds.
2. Run `print-bridge/packaging/macos/build-pkg.sh`.
3. Run `print-bridge/packaging/macos/notarize-macos.sh` after `ORTHOCAD_APPLE_ID`, `ORTHOCAD_APPLE_TEAM_ID`, and `ORTHOCAD_APPLE_APP_PASSWORD_FILE` are set. Without those, notarization is skipped.
4. Create a disk image from the package if you also want `OrthoCAD-Print-Bridge.dmg`.

Publish `OrthoCAD-Print-Bridge.pkg` and `OrthoCAD-Print-Bridge.dmg`.

## Signed auto-update

Installed bridges read `updateManifestUrl` from `bridge.json`. A manifest is accepted only when the Ed25519 signature matches a trusted public key, the manifest is unexpired, and the version is newer than the installed version. Unsigned, tampered, expired, and downgrade manifests are ignored.

Generate a release key outside the repo. Point `ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE` at it and run `node print-bridge/packaging/sign-update-manifest.mjs <manifest.json>`. Do not commit the private key. Put the public key in `update-public-keys.json` beside the installed bridge.

The current installed version is `2026.11.10.1` in `vertex/shared/print-bridge-version.ts`. That build includes per-printer Moonraker status from the bridge check-in. An older installed bridge picks it up from the next accepted manifest. It does not need a manual relay update.

## Legacy command-line entry

`vertex/print-bridge/main.ts` remains for development and for an already enrolled computer that still starts from the environment. `runBridgeSession` still defaults to one cycle so unit tests stay bounded. The installed service loops that call itself. The product path is the installer, not the command line.
