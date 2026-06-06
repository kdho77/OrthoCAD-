// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Maximum decoded GLB size (15 MB). */
export const MAX_GLB_BYTES = 15 * 1024 * 1024;

export type GlbValidationResult =
    | { ok: true; bytes: Buffer }
    | { ok: false; reason: string };

/** Validates base64 GLB payload: size cap + glTF binary magic header. */
export function validateGlbBase64(glbBase64: string): GlbValidationResult {
    let bytes: Buffer;
    try {
        bytes = Buffer.from(glbBase64, "base64");
    } catch {
        return { ok: false, reason: "Invalid base64 encoding" };
    }

    if (bytes.length === 0) {
        return { ok: false, reason: "Empty GLB payload" };
    }
    if (bytes.length > MAX_GLB_BYTES) {
        return { ok: false, reason: `GLB exceeds ${MAX_GLB_BYTES / (1024 * 1024)} MB limit` };
    }

    // glTF binary magic: 0x46546C67 ("glTF")
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x46546c67) {
        return { ok: false, reason: "Invalid GLB file (missing glTF magic header)" };
    }

    return { ok: true, bytes };
}
