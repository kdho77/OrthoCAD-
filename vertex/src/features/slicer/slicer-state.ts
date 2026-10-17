// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    DEFAULT_INFILL_DENSITY_PCT,
    DEFAULT_PRINT_DIRECTION,
    defaultWallLoopsForMaterial,
    REINFORCED_WALL_LOOPS,
    type VertexSliceMaterialId,
    type VertexSlicePrintDirection,
} from "../../../shared/vertexslice/contract";
import type { SlicerPublicError } from "../../../shared/vertexslice/errors";
import type { GcodeStats } from "../../../shared/vertexslice/gcode-stats";
import type { FootSideTag, ParsedSlicerMesh } from "./slicer-mesh";
import type { SlicerPaymentStatus } from "./slicer-pay";

export type SlicerUiStatus = "empty" | "uploading" | "validating" | "slicing" | "error" | "done" | "outdated";

export type WallPreset = "standard" | "reinforced" | "custom";
export type SliceStep = "Preparing" | "Slicing" | "Packaging";

export interface SlicerFileSlot {
    id: string;
    file: File;
    mesh: ParsedSlicerMesh | null;
    side: FootSideTag | null;
    progress: number;
    issue: { message: string; fix: string } | null;
    treatedAsInches: boolean;
}

export interface SliceDownload {
    gcode: string;
    filename: string;
}

export interface SliceResult {
    downloads: SliceDownload[];
    stats: GcodeStats;
    requestId: string;
    material: VertexSliceMaterialId;
    printDirection: VertexSlicePrintDirection;
    wallLoops: number;
    infillDensity: number;
}

export interface SlicerState {
    status: SlicerUiStatus;
    files: SlicerFileSlot[];
    material: VertexSliceMaterialId | null;
    printDirection: VertexSlicePrintDirection;
    wallPreset: WallPreset;
    wallLoops: number;
    infillDensity: number;
    advancedOpen: boolean;
    missingHighlight: "file" | "material" | "direction" | null;
    sliceStep: SliceStep;
    slicingSlow: boolean;
    queuedReslice: boolean;
    error: SlicerPublicError | null;
    result: SliceResult | null;
    paymentStatus: SlicerPaymentStatus;
    paymentId: string | null;
    paymentError: string | null;
}

export function initialSlicerState(): SlicerState {
    return {
        status: "empty",
        files: [],
        material: null,
        printDirection: DEFAULT_PRINT_DIRECTION,
        wallPreset: "standard",
        wallLoops: defaultWallLoopsForMaterial(null),
        infillDensity: DEFAULT_INFILL_DENSITY_PCT,
        advancedOpen: false,
        missingHighlight: null,
        sliceStep: "Preparing",
        slicingSlow: false,
        queuedReslice: false,
        error: null,
        result: null,
        paymentStatus: "unpaid",
        paymentId: null,
        paymentError: null,
    };
}

export function settingsFingerprint(s: SlicerState): string {
    return [s.material, s.printDirection, s.wallLoops, s.infillDensity, ...s.files.map((f) => f.id)].join(
        "|",
    );
}

export type SlicerAction =
    | { type: "reset" }
    | { type: "slice-another" }
    | { type: "highlight"; field: SlicerState["missingHighlight"] }
    | { type: "set-status"; status: SlicerUiStatus }
    | { type: "uploading"; files: SlicerFileSlot[] }
    | { type: "progress"; id: string; progress: number }
    | { type: "validated"; files: SlicerFileSlot[] }
    | { type: "remove-file"; id: string }
    | { type: "set-side"; id: string; side: FootSideTag }
    | { type: "treat-inches"; id: string; mesh: ParsedSlicerMesh }
    | { type: "set-material"; material: VertexSliceMaterialId }
    | { type: "set-direction"; printDirection: VertexSlicePrintDirection }
    | { type: "set-wall-preset"; preset: WallPreset }
    | { type: "set-wall-loops"; wallLoops: number }
    | { type: "set-infill"; infillDensity: number }
    | { type: "reset-defaults" }
    | { type: "toggle-advanced" }
    | { type: "start-slicing" }
    | { type: "slice-step"; step: SliceStep }
    | { type: "slicing-slow"; slow: boolean }
    | { type: "queue-reslice" }
    | { type: "error"; error: SlicerPublicError }
    | { type: "done"; result: SliceResult }
    | { type: "start-pay" }
    | { type: "paid"; paymentId: string }
    | { type: "pay-failed"; error: string };

function markOutdated(state: SlicerState): SlicerState {
    if (state.status === "done" && state.result) {
        return { ...state, status: "outdated" };
    }
    if (state.status === "slicing") {
        return { ...state, queuedReslice: true };
    }
    return state;
}

export function slicerReducer(state: SlicerState, action: SlicerAction): SlicerState {
    switch (action.type) {
        case "reset":
            return initialSlicerState();
        case "slice-another":
            return {
                ...initialSlicerState(),
                material: state.material,
                printDirection: state.printDirection,
                wallPreset: state.wallPreset,
                wallLoops: state.wallLoops,
                infillDensity: state.infillDensity,
            };
        case "highlight":
            return { ...state, missingHighlight: action.field };
        case "set-status":
            return { ...state, status: action.status };
        case "uploading":
            return {
                ...state,
                status: "uploading",
                files: action.files,
                error: null,
                missingHighlight: null,
            };
        case "progress":
            return {
                ...state,
                files: state.files.map((f) => (f.id === action.id ? { ...f, progress: action.progress } : f)),
            };
        case "validated":
            return { ...state, status: "empty", files: action.files };
        case "remove-file": {
            const files = state.files.filter((f) => f.id !== action.id);
            return markOutdated({
                ...state,
                files,
                status: files.length === 0 && state.status !== "error" ? "empty" : state.status,
                result: files.length === 0 ? null : state.result,
            });
        }
        case "set-side":
            return {
                ...state,
                files: state.files.map((f) => (f.id === action.id ? { ...f, side: action.side } : f)),
            };
        case "treat-inches":
            return markOutdated({
                ...state,
                files: state.files.map((f) =>
                    f.id === action.id ? { ...f, mesh: action.mesh, treatedAsInches: true } : f,
                ),
            });
        case "set-material": {
            const nextLoops =
                state.wallPreset === "standard"
                    ? defaultWallLoopsForMaterial(action.material)
                    : state.wallPreset === "reinforced"
                      ? REINFORCED_WALL_LOOPS
                      : state.wallLoops;
            return markOutdated({
                ...state,
                material: action.material,
                wallLoops: nextLoops,
                missingHighlight: state.missingHighlight === "material" ? null : state.missingHighlight,
            });
        }
        case "set-direction":
            return markOutdated({
                ...state,
                printDirection: action.printDirection,
                missingHighlight: state.missingHighlight === "direction" ? null : state.missingHighlight,
            });
        case "set-wall-preset": {
            const loops =
                action.preset === "reinforced"
                    ? REINFORCED_WALL_LOOPS
                    : defaultWallLoopsForMaterial(state.material);
            return markOutdated({
                ...state,
                wallPreset: action.preset,
                wallLoops: loops,
            });
        }
        case "set-wall-loops":
            return markOutdated({
                ...state,
                wallPreset: "custom",
                wallLoops: action.wallLoops,
            });
        case "set-infill":
            return markOutdated({ ...state, infillDensity: action.infillDensity });
        case "reset-defaults":
            return markOutdated({
                ...state,
                wallPreset: "standard",
                wallLoops: defaultWallLoopsForMaterial(state.material),
                infillDensity: DEFAULT_INFILL_DENSITY_PCT,
            });
        case "toggle-advanced":
            return { ...state, advancedOpen: !state.advancedOpen };
        case "start-slicing":
            return {
                ...state,
                status: "slicing",
                sliceStep: "Preparing",
                slicingSlow: false,
                queuedReslice: false,
                error: null,
                missingHighlight: null,
                paymentStatus: "unpaid",
                paymentId: null,
                paymentError: null,
            };
        case "slice-step":
            return { ...state, sliceStep: action.step };
        case "slicing-slow":
            return { ...state, slicingSlow: action.slow };
        case "queue-reslice":
            return { ...state, queuedReslice: true };
        case "error":
            return { ...state, status: "error", error: action.error, slicingSlow: false };
        case "done":
            return {
                ...state,
                status: "done",
                result: action.result,
                error: null,
                slicingSlow: false,
                queuedReslice: false,
                paymentStatus: "unpaid",
                paymentId: null,
                paymentError: null,
            };
        case "start-pay":
            if (!state.result || (state.status !== "done" && state.status !== "outdated")) return state;
            return { ...state, paymentStatus: "paying", paymentError: null };
        case "paid":
            if (state.paymentStatus !== "paying" && state.paymentStatus !== "unpaid") return state;
            return { ...state, paymentStatus: "paid", paymentId: action.paymentId, paymentError: null };
        case "pay-failed":
            return { ...state, paymentStatus: "failed", paymentError: action.error };
        default:
            return state;
    }
}

export type DemoSlicerState =
    | "empty"
    | "uploading"
    | "validating"
    | "slicing"
    | "error"
    | "done"
    | "outdated"
    | "pay"
    | "paid";

function demoFile(partial: Partial<SlicerFileSlot> = {}): SlicerFileSlot {
    return {
        id: "demo",
        file: new File([new Uint8Array([0])], "insole.stl", { type: "model/stl" }),
        mesh: null,
        side: null,
        progress: 0,
        issue: null,
        treatedAsInches: false,
        ...partial,
    };
}

const DEMO_STATS: GcodeStats = {
    printTimeSeconds: 45 * 60 + 12,
    filamentGrams: 10.5,
    filamentMeters: 12.345,
    layers: 42,
};

export function demoSlicerState(kind: DemoSlicerState, fault?: string | null): SlicerState {
    const base = initialSlicerState();
    const meshy = demoFile({
        mesh: {
            positions: new Float32Array([0, 0, 0, 270, 0, 0, 270, 90, 0, 0, 0, 0, 270, 90, 0, 0, 90, 0]),
            triangleCount: 2,
            bounds: {
                min: [0, 0, 0],
                max: [270, 90, 15],
                size: [270, 90, 15],
                lengthMm: 270,
                widthMm: 90,
                heightMm: 15,
            },
            closed: true,
            extension: ".stl",
        },
        progress: 100,
    });
    const result: SliceResult = {
        downloads: [
            {
                gcode: "; material = ApexCore\n; print_direction = toe_first\nG28\n",
                filename: "insole_ApexCore_toefirst_1w.gcode",
            },
        ],
        stats: DEMO_STATS,
        requestId: "demo-req-1",
        material: "apex_core",
        printDirection: "toe_first",
        wallLoops: 1,
        infillDensity: 20,
    };
    switch (kind) {
        case "empty":
            return base;
        case "uploading":
            return { ...base, status: "uploading", files: [demoFile({ progress: 42 })] };
        case "validating":
            return { ...base, status: "validating", files: [demoFile({ progress: 100 })] };
        case "slicing":
            return {
                ...base,
                status: "slicing",
                files: [meshy],
                material: "apex_core",
                sliceStep: "Slicing",
            };
        case "error":
            return {
                ...base,
                status: "error",
                files: [meshy],
                material: "apex_core",
                error:
                    fault === "5xx"
                        ? {
                              code: "auth_config",
                              cause: "Something on our side. Try again; if it repeats, share this ID",
                              nextStep: "Retry. If it happens again, send this request ID to support.",
                              requestId: "demo-5xx-42",
                          }
                        : {
                              code: "timeout",
                              cause: "The slicer timed out before it finished.",
                              nextStep:
                                  "Retry with the same file. If it keeps timing out, simplify the mesh and export STL again.",
                              requestId: "demo-timeout-42",
                          },
            };
        case "done":
            return { ...base, status: "done", files: [meshy], material: "apex_core", result };
        case "pay":
            return {
                ...base,
                status: "done",
                files: [meshy],
                material: "apex_core",
                result,
                paymentStatus: "paying",
            };
        case "paid":
            return {
                ...base,
                status: "done",
                files: [meshy],
                material: "apex_core",
                result,
                paymentStatus: "paid",
                paymentId: "mock_demo_pay",
            };
        case "outdated":
            return {
                ...base,
                status: "outdated",
                files: [meshy],
                material: "apex_core",
                printDirection: "heel_first",
                result,
            };
        default:
            return base;
    }
}
