// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    DEFAULT_MATERIAL_ID,
    DEFAULT_PRINT_DIRECTION,
    DEFAULT_PROFILE_ID,
    DEFAULT_WALL_LOOPS,
    formatInfillDensity,
    resolveMaterialId,
    VERTEXSLICE_MATERIAL_DISPLAY,
    VERTEXSLICE_MAX_UPLOAD_BYTES,
    VERTEXSLICE_PROFILE_IDS,
    type VertexSliceHealthResponse,
    type VertexSliceMaterialId,
    type VertexSliceMaterialsResponse,
    type VertexSlicePrintDirection,
    type VertexSliceProfilesResponse,
    type VertexSliceSliceInput,
    type VertexSliceSliceSuccess,
    validateInfillDensityPercent,
    validatePrintDirection,
    validateWallLoops,
} from "../../../shared/vertexslice/contract.js";
import { VertexSliceHttpError } from "../../../shared/vertexslice/errors.js";
import type { VertexSliceClient } from "./vertexslice-client.js";

export type MockSlicerFault = "timeout" | "5xx" | "busy" | "bad_mesh";

export interface MockSlicerOptions {
    /** Extra delay before a successful slice. Tests should leave this at 0. */
    delayMs?: number;
    now?: () => number;
}

function modelSize(model: VertexSliceSliceInput["model"]): number {
    if (typeof Blob !== "undefined" && model instanceof Blob) return model.size;
    if (model instanceof Uint8Array) return model.byteLength;
    if (model instanceof ArrayBuffer) return model.byteLength;
    return 0;
}

function filenameOf(input: VertexSliceSliceInput): string {
    return (input.filename || "model.stl").toLowerCase();
}

export function detectMockFault(
    input: VertexSliceSliceInput,
    explicit?: string | null,
): MockSlicerFault | null {
    const fault = (explicit ?? "").trim().toLowerCase();
    if (fault === "timeout" || fault === "5xx" || fault === "busy" || fault === "bad_mesh") {
        return fault;
    }
    const name = filenameOf(input);
    if (name.includes("timeout")) return "timeout";
    if (name.includes("5xx") || name.includes("server-error")) return "5xx";
    if (name.includes("busy")) return "busy";
    if (name.includes("bad-mesh") || name.includes("nonmanifold") || name.includes("non-manifold")) {
        return "bad_mesh";
    }
    return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) {
        if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new Error("aborted"));
        };
        if (signal) {
            if (signal.aborted) {
                clearTimeout(timer);
                onAbort();
                return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
        }
    });
}

function buildMockGcode(opts: {
    material: VertexSliceMaterialId;
    printDirection: VertexSlicePrintDirection;
    wallLoops: number;
    infillDensity: string;
    profileId: string;
    filename: string;
}): string {
    const display = VERTEXSLICE_MATERIAL_DISPLAY[opts.material];
    return [
        "; VertexSlice mock G-code",
        `; generated_by = vertexslice-mock`,
        `; filename = ${opts.filename}`,
        `; profile_id = ${opts.profileId}`,
        `; material = ${display}`,
        `; material_id = ${opts.material}`,
        `; print_direction = ${opts.printDirection}`,
        `; wall_loops = ${opts.wallLoops}`,
        `; infill_density = ${opts.infillDensity}`,
        "; filament used [mm] = 12345.00",
        "; filament used [g] = 10.50",
        "; estimated printing time (normal mode) = 45m 12s",
        "; total layers count = 42",
        "G28 ; home",
        "G1 Z0.42 F600",
        "G1 X10 Y10 E0.4",
        "M84",
        "",
    ].join("\n");
}

const MOCK_MATERIALS: VertexSliceMaterialsResponse = {
    default: DEFAULT_MATERIAL_ID,
    materials: [
        { id: "apex_core", display_name: "ApexCore", nozzle: 225, bed: 0 },
        { id: "apex_forge", display_name: "ApexForge", nozzle: 245, bed: 0 },
        { id: "apex_bounce", display_name: "ApexBounce", nozzle: 225, bed: 60 },
        { id: "apex_light", display_name: "ApexLight", nozzle: 260, bed: 0 },
    ],
};

const MOCK_PROFILES: VertexSliceProfilesResponse = {
    profiles: VERTEXSLICE_PROFILE_IDS.map((id) => ({
        id,
        description: id,
        machine: "resources/profiles/IdeaFormer/machine/Vertex Apex V2 1.0 nozzle.json",
        process: "resources/profiles/IdeaFormer/process/0.42mm TPU Insole @Vertex Apex V2.json",
        filament: "resources/profiles/IdeaFormer/filament/VERTEX_APEX_CORE_95A.json",
        defaults: {
            wall_loops: DEFAULT_WALL_LOOPS,
            infill_density_percent: 20,
            print_direction: DEFAULT_PRINT_DIRECTION,
        },
        user_modifiable: ["wall_loops", "infill_density_percent", "print_direction"],
    })),
    tunables: {
        wall_loops: { default: 1, min: 1, max: 6, user_modifiable: true },
        infill_density_percent: {
            min: 5,
            max: 100,
            user_modifiable: true,
            hardness_preset_defaults: {
                extra_soft: 14,
                soft: 20,
                medium: 26,
                hard: 32,
                extra_hard: 38,
            },
        },
        print_direction: {
            default: DEFAULT_PRINT_DIRECTION,
            choices: ["toe_first", "heel_first"],
            user_modifiable: true,
        },
    },
};

export function createMockVertexSliceClient(
    options: MockSlicerOptions = {},
    explicitFault?: () => string | null,
): VertexSliceClient {
    const delayMs = options.delayMs ?? 0;

    return {
        async health(): Promise<VertexSliceHealthResponse> {
            return { status: "ok", service: "vertexslice-slicer-mock" };
        },
        async materials() {
            return MOCK_MATERIALS;
        },
        async profiles() {
            return MOCK_PROFILES;
        },
        async slice(input, init) {
            if (modelSize(input.model) > VERTEXSLICE_MAX_UPLOAD_BYTES) {
                throw new VertexSliceHttpError(413, "Upload too large");
            }
            let material: VertexSliceMaterialId;
            try {
                material = resolveMaterialId(input.material);
            } catch (err) {
                throw new VertexSliceHttpError(400, err instanceof Error ? err.message : String(err));
            }
            if (
                input.profileId &&
                !VERTEXSLICE_PROFILE_IDS.includes(input.profileId as (typeof VERTEXSLICE_PROFILE_IDS)[number])
            ) {
                throw new VertexSliceHttpError(400, `Unknown profile_id: ${input.profileId}`);
            }

            let wallLoops = material === "apex_light" ? 2 : DEFAULT_WALL_LOOPS;
            let infill = "20%";
            let printDirection: VertexSlicePrintDirection = DEFAULT_PRINT_DIRECTION;
            try {
                if (input.wallLoops != null && String(input.wallLoops).trim() !== "") {
                    wallLoops = validateWallLoops(Number(input.wallLoops));
                }
                if (input.infillDensity != null && String(input.infillDensity).trim() !== "") {
                    const raw = String(input.infillDensity).trim().replace(/%$/, "");
                    infill = formatInfillDensity(validateInfillDensityPercent(Number(raw)));
                }
                printDirection = validatePrintDirection(input.printDirection);
            } catch (err) {
                throw new VertexSliceHttpError(400, err instanceof Error ? err.message : String(err));
            }

            const fault = detectMockFault(input, explicitFault?.() ?? null);
            if (fault === "timeout") throw new VertexSliceHttpError(504, "Slice timed out");
            if (fault === "5xx") throw new VertexSliceHttpError(500, "Internal slicer error");
            if (fault === "busy") throw new VertexSliceHttpError(503, "Server busy");
            if (fault === "bad_mesh") {
                throw new VertexSliceHttpError(400, "Mesh is not closed / non-manifold");
            }

            await sleep(delayMs, init?.signal);

            const profileId = input.profileId || DEFAULT_PROFILE_ID;
            const filename = input.filename || "model.stl";
            const gcode = buildMockGcode({
                material,
                printDirection,
                wallLoops,
                infillDensity: infill,
                profileId,
                filename,
            });
            const headers: VertexSliceSliceSuccess["headers"] = {
                sliceSeconds: "0.05",
                peakRssKb: "1024",
                profileId,
                material,
                wallLoops: String(wallLoops),
                infillDensity: infill,
                printDirection,
            };
            return { gcode, headers, status: 200 };
        },
    };
}

export { buildMockGcode, MOCK_MATERIALS, MOCK_PROFILES };
