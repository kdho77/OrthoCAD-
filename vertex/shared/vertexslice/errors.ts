// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export type SlicerErrorCode =
    | "bad_mesh"
    | "timeout"
    | "server_busy"
    | "auth_config"
    | "validation"
    | "payload_too_large"
    | "unauthorized";

export interface SlicerPublicError {
    code: SlicerErrorCode;
    cause: string;
    nextStep: string;
    requestId: string;
}

export class VertexSliceHttpError extends Error {
    readonly status: number;
    readonly detail: string;

    constructor(status: number, detail: string) {
        super(detail);
        this.name = "VertexSliceHttpError";
        this.status = status;
        this.detail = detail;
    }
}

function looksLikeBadMesh(detail: string): boolean {
    const t = detail.toLowerCase();
    return (
        t.includes("mesh") ||
        t.includes("manifold") ||
        t.includes("non-manifold") ||
        t.includes("not closed") ||
        t.includes("empty model") ||
        t.includes("no geometry")
    );
}

export function mapVertexSliceError(status: number, detail: string, requestId: string): SlicerPublicError {
    if (status === 413) {
        return {
            code: "payload_too_large",
            cause: "This file is larger than 50 MB.",
            nextStep: "Export a smaller STL from OrthoCAD (Export > STL) and try again.",
            requestId,
        };
    }
    if (status === 401 || status === 403) {
        return {
            code: "auth_config",
            cause: "Something on our side. Try again; if it repeats, share this ID",
            nextStep: "Retry. If it happens again, send this request ID to support.",
            requestId,
        };
    }
    if (status === 408 || status === 504) {
        return {
            code: "timeout",
            cause: "The slicer timed out before it finished.",
            nextStep:
                "Retry with the same file. If it keeps timing out, simplify the mesh and export STL again.",
            requestId,
        };
    }
    if (status === 429 || status === 503) {
        return {
            code: "server_busy",
            cause: "The slicer is busy right now.",
            nextStep: "Wait a moment, then Retry.",
            requestId,
        };
    }
    if (status === 400 && looksLikeBadMesh(detail)) {
        return {
            code: "bad_mesh",
            cause: "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
            nextStep: "Export a watertight STL and upload it again.",
            requestId,
        };
    }
    if (status === 400) {
        return {
            code: "validation",
            cause: detail || "Those settings aren't valid for this slicer.",
            nextStep: "Check material, walls, infill, and print direction, then Retry.",
            requestId,
        };
    }
    if (status >= 500) {
        return {
            code: "auth_config",
            cause: "Something on our side. Try again; if it repeats, share this ID",
            nextStep: "Retry. If it happens again, send this request ID to support.",
            requestId,
        };
    }
    return {
        code: "auth_config",
        cause: "Something on our side. Try again; if it repeats, share this ID",
        nextStep: "Retry. If it happens again, send this request ID to support.",
        requestId,
    };
}
