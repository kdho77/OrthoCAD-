// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    DEFAULT_PRINT_DIRECTION,
    type VertexSliceMaterialId,
    type VertexSlicePrintDirection,
} from "../../../shared/vertexslice/contract";
import type { SlicerPublicError } from "../../../shared/vertexslice/errors";
import type { GcodeStats } from "../../../shared/vertexslice/gcode-stats";
import { classDensityPct, type NAMED_HARDNESS_CLASSES } from "../../lib/hardness";
import { type FootSideTag, makeInsoleDemoMesh, type ParsedSlicerMesh } from "./slicer-mesh";
import type { SlicerPaymentStatus } from "./slicer-pay";

/** Whole-insole hardness. Same five levels as the OrthoCAD element selector. */
export type SlicerHardness = (typeof NAMED_HARDNESS_CLASSES)[number];

/** OrthoCAD's print-recipe default when a design has no hardness yet. */
export const DEFAULT_SLICER_HARDNESS: SlicerHardness = "Medium";

/**
 * apex-v2-insole-95a wall_loops. The old Walls control sent 1 (Standard),
 * 2 (ApexLight standard), or 4 (Reinforced). Customers no longer choose;
 * every slice sends this production count. The profile id is unchanged.
 */
export const PRODUCTION_WALL_LOOPS = 2;

/** Hardness infill, or the advanced override when the customer set one. */
export function slicerInfillPercent(hardness: SlicerHardness, overridePct: number | null): number {
    if (overridePct != null) return overridePct;
    return classDensityPct(hardness);
}

export type SlicerUiStatus = "empty" | "uploading" | "validating" | "slicing" | "error" | "done" | "outdated";

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
    /** Present only for the in-page demo fixture. Real slices keep G-code sealed until paid. */
    gcode?: string;
    sealed?: string;
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
    /** Off leaves the uploaded bytes unchanged. On fuses the CAD sacrificial leader. */
    includeLeader: boolean;
    /** Always the production profile count. Not a customer setting. */
    wallLoops: number;
    hardness: SlicerHardness;
    /** Set only when Advanced infill replaces the hardness level. */
    infillOverridePct: number | null;
    /** Shown when a second file or a pair drop is refused. */
    uploadNotice: string | null;
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
        includeLeader: false,
        wallLoops: PRODUCTION_WALL_LOOPS,
        hardness: DEFAULT_SLICER_HARDNESS,
        infillOverridePct: null,
        uploadNotice: null,
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
    return [
        s.material,
        s.printDirection,
        s.includeLeader ? "leader" : "no-leader",
        s.wallLoops,
        s.hardness,
        s.infillOverridePct ?? "hardness",
        ...s.files.map((f) => f.id),
    ].join("|");
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
    | { type: "set-leader"; includeLeader: boolean }
    | { type: "set-hardness"; hardness: SlicerHardness }
    | { type: "set-infill-override"; infillOverridePct: number | null }
    | { type: "upload-notice"; message: string | null }
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
                includeLeader: state.includeLeader,
                wallLoops: PRODUCTION_WALL_LOOPS,
                hardness: state.hardness,
                infillOverridePct: state.infillOverridePct,
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
                uploadNotice: null,
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
        case "set-material":
            return markOutdated({
                ...state,
                material: action.material,
                wallLoops: PRODUCTION_WALL_LOOPS,
                missingHighlight: state.missingHighlight === "material" ? null : state.missingHighlight,
            });
        case "set-direction":
            return markOutdated({
                ...state,
                printDirection: action.printDirection,
                missingHighlight: state.missingHighlight === "direction" ? null : state.missingHighlight,
            });
        case "set-leader":
            return markOutdated({ ...state, includeLeader: action.includeLeader });
        case "set-hardness":
            return markOutdated({ ...state, hardness: action.hardness });
        case "set-infill-override":
            return markOutdated({ ...state, infillOverridePct: action.infillOverridePct });
        case "upload-notice":
            return { ...state, uploadNotice: action.message };
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
        file: new File([new Uint8Array([0])], "Extrusion_FlattenHeel_HolePattern_Left.stl", {
            type: "model/stl",
        }),
        mesh: makeInsoleDemoMesh(),
        progress: 100,
    });
    const result: SliceResult = {
        downloads: [
            {
                gcode: "; material = ApexCore\n; print_direction = toe_first\nG28\n",
                filename: "insole_ApexCore_toefirst_2w.gcode",
            },
        ],
        stats: DEMO_STATS,
        requestId: "demo-req-1",
        material: "apex_core",
        printDirection: "toe_first",
        wallLoops: PRODUCTION_WALL_LOOPS,
        infillDensity: slicerInfillPercent(DEFAULT_SLICER_HARDNESS, null),
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
