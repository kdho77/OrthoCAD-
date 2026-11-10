// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Release and CI installers bake this manifest URL into the payload.
// A local unsigned build can still override it with ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL.

export {
    manifestUrlForPayload,
    RELEASE_CLOUD_ORIGIN,
    RELEASE_UPDATE_MANIFEST_URL,
    resolveUpdateManifestUrl,
} from "./baked-config.mjs";
