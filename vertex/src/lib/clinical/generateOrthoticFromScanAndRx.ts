// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type * as THREE from "three";
import type { BufferGeometry } from "three";
import { medialWidthSignForSide } from "@/lib/clinical/medial-sign";
import {
    detectRxConflicts,
    mergeScanFitWithPrescription,
} from "@/lib/clinical/resolve-rx-vs-scan-corrections";
import { computeScanRegistration, registrationKabschReady } from "@/lib/clinical/scan-registration-compute";
import { suggestShoeWidthFromBallWidth } from "@/lib/clinical/suggest-shoe-width-from-scan";
import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { ArchFitError } from "@/lib/geometry/fit-arch-from-scan";
import {
    ARCH_MATCH_BLOCK_RMS_MM,
    ARCH_MATCH_WARN_RMS_MM,
    gateArchMatch,
    matchClinicalParamsFromRegisteredScanAuto,
    shouldAutoApplySize,
    suggestSizeFromScanGeometry,
} from "@/lib/geometry/match-design-from-scan";
import { measureBallWidthMm } from "@/lib/geometry/measure-foot-from-scan";
import type { ScanDisplayInfo } from "@/lib/geometry/scan-display";
import { resolveScanMeshMatrix } from "@/lib/geometry/scan-display";
import type { SuggestedScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { ScanMarkers, ScanRegistrationState } from "@/stores/scan-store";
import { getScanRegistrationMatrix } from "@/stores/scan-store";
import type { DesignState, ParsedElement, PrescriptionParseResult, Side, SideCorrections } from "@/types";

export type FootScanBundle = {
    side: Side;
    geometry: BufferGeometry;
    display: ScanDisplayInfo;
    markers: ScanMarkers;
    suggestedLandmarks?: SuggestedScanLandmarks | null;
    manualOffset?: { x: number; y: number; z: number; rz?: number } | null;
    keepSetApproved?: boolean;
};

export type GenerateOrthoticInput = {
    baselineDesign: DesignState;
    scans: FootScanBundle[];
    rawBaseGeometry: BufferGeometry;
    sourceAssetId: string;
    prescription: PrescriptionParseResult | null;
    /** Test seam — override clinical match (defaults to production fit). */
    matchClinical?: typeof matchClinicalParamsFromRegisteredScanAuto;
};

export type FootGenerationSummary = {
    side: Side;
    sizeApplied: boolean;
    sizeLabel?: string;
    widthClass?: string;
    archSource?: "marker" | "gap";
    archMessage?: string;
    registrationRmsMm?: number | null;
    landmarksAutoFilled: MarkerId[];
    reviewLandmarks: MarkerId[];
};

type MarkerId = "M1" | "M2" | "M3" | "ARCH";

export type GenerateOrthoticSuccess = {
    ok: true;
    design: DesignState;
    warnings: string[];
    reviewItems: string[];
    elementSuggestions: ParsedElement[];
    perFoot: FootGenerationSummary[];
    rxNotes?: string;
};

export type GenerateOrthoticFailure = {
    ok: false;
    reason: string;
    failedStep: string;
    warnings: string[];
};

export type GenerateOrthoticResult = GenerateOrthoticSuccess | GenerateOrthoticFailure;

function cloneDesignState(d: DesignState): DesignState {
    return {
        ...d,
        corrections: {
            ...d.corrections,
            left: { ...d.corrections.left },
            right: { ...d.corrections.right },
        },
        elements: d.elements.map((e) => ({ ...e })),
        trimlines: d.trimlines ? { ...d.trimlines } : d.trimlines,
        sinks: d.sinks
            ? { ...d.sinks, left: [...(d.sinks.left ?? [])], right: [...(d.sinks.right ?? [])] }
            : d.sinks,
    };
}

function cloneMarkers(m: ScanMarkers): ScanMarkers {
    const cloneV = (v: THREE.Vector3 | null) => (v ? v.clone() : null);
    return { M1: cloneV(m.M1), M2: cloneV(m.M2), M3: cloneV(m.M3), ARCH: cloneV(m.ARCH) };
}

function autoFillMarkers(args: {
    side: Side;
    geometry: BufferGeometry;
    markers: ScanMarkers;
    suggested?: SuggestedScanLandmarks | null;
}): {
    markers: ScanMarkers;
    autoFilled: MarkerId[];
    review: MarkerId[];
    warnings: string[];
} {
    const warnings: string[] = [];
    const autoFilled: MarkerId[] = [];
    const review: MarkerId[] = [];
    let markers = cloneMarkers(args.markers);
    const sug = args.suggested ?? suggestScanLandmarks(args.geometry, args.side);
    if (!sug) {
        if (!markers.M1 || !markers.M2 || !markers.M3) {
            warnings.push(`${args.side}: could not suggest M1–M3 — place markers manually`);
        }
        return { markers, autoFilled, review, warnings };
    }

    const tryFill = (
        id: MarkerId,
        point: THREE.Vector3,
        confidence: "high" | "medium" | "low" | undefined,
    ) => {
        if (markers[id]) return;
        if (confidence === "low") {
            review.push(id);
            warnings.push(`${args.side}: ${id} suggestion low confidence — confirm landmark`);
            return;
        }
        markers = { ...markers, [id]: point.clone() };
        autoFilled.push(id);
    };

    tryFill("M1", sug.M1, "high");
    tryFill("M2", sug.M2, "high");
    tryFill("M3", sug.M3, "high");
    if (sug.ARCH) {
        tryFill("ARCH", sug.ARCH, sug.archConfidence ?? "medium");
    } else if (!markers.ARCH) {
        review.push("ARCH");
        warnings.push(`${args.side}: ARCH apex not suggested — place ARCH or allow gap-fit`);
    }

    // Medial/lateral sanity: M1 medial of M2 on width axis for assigned side.
    if (markers.M1 && markers.M2) {
        const medialSign = medialWidthSignForSide(args.side);
        const m1Medial = markers.M1.y * medialSign;
        const m2Medial = markers.M2.y * medialSign;
        if (m1Medial <= m2Medial) {
            warnings.push(`${args.side}: M1 may be on wrong side — verify medial/lateral landmarks`);
            review.push("M1", "M2");
        }
    }

    return { markers, autoFilled, review, warnings };
}

function applySizingToDesign(
    design: DesignState,
    suggestion: ReturnType<typeof suggestSizeFromScanGeometry>,
    side: Side,
): { design: DesignState; applied: boolean; label?: string } {
    if (!suggestion) return { design, applied: false };
    if (!shouldAutoApplySize(design, suggestion) && suggestion.confidence === "low") {
        return { design, applied: false, label: "Size not auto-applied (low confidence)" };
    }
    const system = design.sizeSystem ?? "us";
    const next = { ...design };
    if (system === "uk") next.ukSize = suggestion.ukSize;
    else if (system === "mm") next.footLengthMm = suggestion.layout.footLengthMm;
    else next.usMenSize = suggestion.usMenSize;
    return {
        design: next,
        applied: true,
        label: `${suggestion.layout.lengthMm.toFixed(0)} mm insole`,
    };
}

function patchSideCorrections(design: DesignState, side: Side, patch: Partial<SideCorrections>): DesignState {
    const thickness = design.thicknessMm;
    const baseSide = side === "left" ? design.corrections.left : design.corrections.right;
    const merged = { ...baseSide, ...patch };
    const clamped = constrainSideCorrections(merged, thickness).constrained;
    if (side === "left") {
        return {
            ...design,
            corrections: {
                ...design.corrections,
                left: clamped,
                right: design.corrections.linked ? clamped : design.corrections.right,
            },
        };
    }
    return {
        ...design,
        corrections: {
            ...design.corrections,
            right: clamped,
        },
    };
}

/**
 * One-shot scan + Rx orthotic generation. Returns a new design snapshot or failure
 * without mutating the input baseline.
 */
export function generateOrthoticFromScanAndRx(input: GenerateOrthoticInput): GenerateOrthoticResult {
    const warnings: string[] = [...detectRxConflicts(input.prescription)];
    const reviewItems: string[] = [];
    const perFoot: FootGenerationSummary[] = [];
    let design: DesignState = cloneDesignState(input.baselineDesign);

    if (input.scans.length === 0) {
        return { ok: false, reason: "Import at least one foot scan", failedStep: "scan", warnings };
    }

    for (const scan of input.scans) {
        if (scan.keepSetApproved === false) {
            return {
                ok: false,
                reason: "Approve the scan keep-set before generating",
                failedStep: "scan_cleanup",
                warnings,
            };
        }
        const vertexCount = scan.geometry.getAttribute("position")?.count ?? 0;
        if (vertexCount < 30) {
            return {
                ok: false,
                reason: `${scan.side} scan mesh too sparse`,
                failedStep: "scan_quality",
                warnings,
            };
        }

        const filled = autoFillMarkers({
            side: scan.side,
            geometry: scan.geometry,
            markers: scan.markers,
            suggested: scan.suggestedLandmarks,
        });
        warnings.push(...filled.warnings);
        reviewItems.push(...filled.review.map((id) => `${scan.side}:${id}`));

        const markers = filled.markers;
        const layoutBefore = insoleLayoutFromDesign(design);
        const regState = computeScanRegistration({
            scanGeometry: scan.geometry,
            scanSide: scan.side,
            display: scan.display,
            markers,
            sourceAssetId: input.sourceAssetId,
            rawBaseGeometry: input.rawBaseGeometry,
            targetLayout: { lengthMm: layoutBefore.lengthMm, widthMm: layoutBefore.widthMm },
        });

        if (!registrationKabschReady(markers)) {
            return {
                ok: false,
                reason: `${scan.side}: incomplete landmarks (need M1–M3)`,
                failedStep: "landmarks",
                warnings,
            };
        }

        const gate = gateArchMatch({
            residualRmsMm: regState.residualRmsMm,
            incomplete: regState.incomplete,
            error: regState.error,
            hasRawBase: true,
            sizeAccepted: true,
        });
        if (!gate.ok) {
            return { ok: false, reason: gate.reason, failedStep: "registration", warnings };
        }
        if (gate.warning) warnings.push(gate.warning);
        if (regState.residualRmsMm != null && regState.residualRmsMm > ARCH_MATCH_BLOCK_RMS_MM) {
            return {
                ok: false,
                reason: `Registration RMS ${regState.residualRmsMm.toFixed(1)} mm exceeds limit`,
                failedStep: "registration",
                warnings,
            };
        }

        const sizeSuggestion = suggestSizeFromScanGeometry({
            geometry: scan.geometry,
            displayScale: scan.display.displayScale,
            dominantRawAxis: scan.display.dominantRawAxis,
            sizeSystem: design.sizeSystem,
            m1: markers.M1,
            m2: markers.M2,
        });
        const sized = applySizingToDesign(design, sizeSuggestion, scan.side);
        design = sized.design;
        if (sizeSuggestion?.warnings.length) warnings.push(...sizeSuggestion.warnings);

        const layout = insoleLayoutFromDesign(design);
        const regSized = computeScanRegistration({
            scanGeometry: scan.geometry,
            scanSide: scan.side,
            display: scan.display,
            markers,
            sourceAssetId: input.sourceAssetId,
            rawBaseGeometry: input.rawBaseGeometry,
            targetLayout: { lengthMm: layout.lengthMm, widthMm: layout.widthMm },
        });
        const registration = regSized as ScanRegistrationState;
        const regMatrix = getScanRegistrationMatrix(registration);
        if (!regMatrix) {
            return {
                ok: false,
                reason: "Registration matrix unavailable",
                failedStep: "registration",
                warnings,
            };
        }

        const scanToBase = resolveScanMeshMatrix(scan.display, regMatrix, scan.manualOffset ?? null);
        const pos = scan.geometry.getAttribute("position");
        if (!pos) {
            return { ok: false, reason: "Scan has no positions", failedStep: "scan", warnings };
        }

        let clinical;
        const matchClinical = input.matchClinical ?? matchClinicalParamsFromRegisteredScanAuto;
        try {
            clinical = matchClinical({
                scanPositions: pos.array as ArrayLike<number>,
                scanVertexCount: pos.count,
                scanToBase,
                rawBase: input.rawBaseGeometry,
                side: scan.side,
                layout,
                archMarkerLocal: markers.ARCH,
                heelMarkerLocal: markers.M3,
                allowGapFit: true,
            });
        } catch (e) {
            const msg =
                e instanceof ArchFitError ? e.message : e instanceof Error ? e.message : "Arch fit failed";
            return { ok: false, reason: msg, failedStep: "arch_fit", warnings };
        }

        let widthClass: string | undefined;
        if (markers.M1 && markers.M2) {
            const ball = measureBallWidthMm(markers.M1, markers.M2, scan.display.displayScale);
            const sw = suggestShoeWidthFromBallWidth({
                ballWidthMm: ball,
                templateBallWidthMm: layout.widthMm,
            });
            widthClass = sw.width;
            if (sw.confidence === "low") {
                warnings.push(`${scan.side}: forefoot width class uncertain — confirm width`);
            }
            if (design.corrections.linked) {
                design = {
                    ...design,
                    shoeWidth: sw.width,
                    shoeWidthBySide: { left: sw.width, right: sw.width },
                };
            } else {
                design = {
                    ...design,
                    shoeWidthBySide: { ...design.shoeWidthBySide, [scan.side]: sw.width },
                };
            }
        }

        const { merged, rxKeys, scanOnlyKeys } = mergeScanFitWithPrescription({
            side: scan.side,
            scanFit: clinical.correction,
            rx: input.prescription,
        });
        if (rxKeys.length) {
            warnings.push(`${scan.side}: Rx overrides scan fit for ${rxKeys.join(", ")}`);
        }
        design = patchSideCorrections(design, scan.side, merged);

        perFoot.push({
            side: scan.side,
            sizeApplied: sized.applied,
            sizeLabel: sized.label,
            widthClass,
            archSource: clinical.archSource,
            archMessage: clinical.message,
            registrationRmsMm: registration.residualRmsMm,
            landmarksAutoFilled: filled.autoFilled,
            reviewLandmarks: filled.review,
        });
        void scanOnlyKeys;
    }

    // Apply global Rx fields once (method/pattern/thickness) without cross-foot correction copy.
    if (input.prescription) {
        if (input.prescription.method) design = { ...design, method: input.prescription.method };
        if (input.prescription.pattern) design = { ...design, pattern: input.prescription.pattern };
        if (input.prescription.thicknessMm != null) {
            design = { ...design, thicknessMm: input.prescription.thicknessMm };
        }
    }

    const elementSuggestions = input.prescription?.elements ?? [];

    return {
        ok: true,
        design,
        warnings,
        reviewItems,
        elementSuggestions,
        perFoot,
        rxNotes: input.prescription?.notes,
    };
}
