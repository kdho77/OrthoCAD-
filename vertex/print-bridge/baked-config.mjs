// Release and CI installers bake this manifest URL into the payload.
// A local unsigned build can still override it with ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL.

export const RELEASE_UPDATE_MANIFEST_URL =
    "https://github.com/kdho77/OrthoCAD-/releases/latest/download/update-manifest.json";

export const RELEASE_CLOUD_ORIGIN = "https://orthocad.vertexorthopedic.com";

export function resolveUpdateManifestUrl(input) {
    const fromEnv = (input.envValue ?? "").trim();
    if (fromEnv.startsWith("https://")) return fromEnv;
    const existing = (input.existing ?? "").trim();
    if (existing.startsWith("https://")) return existing;
    const baked = (input.bakedFile ?? "").trim();
    if (baked.startsWith("https://")) return baked;
    return "";
}

export function manifestUrlForPayload(input) {
    const requested = (input.envValue ?? "").trim();
    if (requested.startsWith("https://")) return requested;
    if (input.origin === RELEASE_CLOUD_ORIGIN) return RELEASE_UPDATE_MANIFEST_URL;
    return "";
}
