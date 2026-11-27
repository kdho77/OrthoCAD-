// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { type ArchBand, FLEXIBLE_APEX_ANTERIOR_MM } from "@/lib/clinical/arch-class";
import {
    forefootWidthDeltaMm,
    measurePlantarArch,
    resolveScanArchAssignment,
} from "@/lib/clinical/measure-scan-arch";
import { interpretOneClickRx } from "@/lib/clinical/one-click-rx";
import {
    type PathologyDesigner,
    type PathologyDesignResult,
    stubPathologyDesigner,
} from "@/lib/clinical/pathology-designer";
import {
    explicitArchTierForSide,
    pathologyAsksToRaiseArch,
} from "@/lib/clinical/resolve-rx-vs-scan-corrections";
import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { ScanDisplayInfo } from "@/lib/geometry/scan-display";
import {
    insoleLayoutForUkSize,
    insoleLayoutForUsMenSize,
    insoleLayoutFromDesign,
    normalizeFootLengthMm,
    ukToUsMen,
    usMenToUk,
} from "@/lib/geometry/shoe-size";
import { SINK_DEFAULT_DEPTH_MM } from "@/lib/geometry/sink";
import type { ScanMarkers } from "@/stores/scan-store";
import type {
    DesignState,
    ElementKind,
    PlacedElement,
    PlacedSink,
    ScanArchTierName,
    ScanDrivenArchRecord,
    Side,
    SideCorrections,
    SinkKind,
} from "@/types";

export type FootScanBundle = {
    side: Side;
    geometry: BufferGeometry;
    display: ScanDisplayInfo;
    markers?: ScanMarkers;
    /** Set when the clinician dragged the arch marker off the detected apex. */
    archMarkerSource?: "scan_measured" | "manual_override";
    keepSetApproved?: boolean;
};

/** Clinician-entered shoe size. Never taken from scan length. */
export type RequiredShoeSize = {
    system: "us" | "uk" | "mm";
    /** US men's size, UK size, or foot length in mm. */
    value: number;
};

export type GenerateOrthoticInput = {
    baselineDesign: DesignState;
    scans: FootScanBundle[];
    /** Required. Generation fails when this is missing. */
    shoeSize: RequiredShoeSize | null;
    /** Per foot. Checked → set the apex slider to +4 mm toward the toe. */
    flexibleBySide?: Partial<Record<Side, boolean>>;
    prescriptionText?: string;
    pathologyDesigner?: PathologyDesigner;
};

export type FootGenerationSummary = {
    side: Side;
    archHeightMeasuredMm: number;
    /** Legacy label. Medium is reported as standard so existing readers stay valid. */
    archBand: ArchBand;
    archReviewBelow18: boolean;
    archHeightMm: number;
    apexMoveMm: number;
    flexible: boolean;
    rxArchOverride: boolean;
    sizeLabel: string;
    scanArch: ScanDrivenArchRecord;
};

export type GenerateOrthoticSuccess = {
    ok: true;
    design: DesignState;
    warnings: string[];
    reviewItems: string[];
    perFoot: FootGenerationSummary[];
    pathology: PathologyDesignResult | null;
};

export type GenerateOrthoticFailure = {
    ok: false;
    reason: string;
    failedStep: string;
    warnings: string[];
};

export type GenerateOrthoticResult = GenerateOrthoticSuccess | GenerateOrthoticFailure;

function freshSide(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        archElongationMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function cloneDesignState(d: DesignState): DesignState {
    return {
        ...d,
        corrections: {
            ...d.corrections,
            left: { ...d.corrections.left },
            right: { ...d.corrections.right },
            linked: false,
        },
        elements: d.elements.map((e) => ({ ...e, position: { ...e.position }, scale: { ...e.scale } })),
        trimlines: d.trimlines ? { ...d.trimlines } : d.trimlines,
        sinks: d.sinks
            ? { ...d.sinks, left: [...(d.sinks.left ?? [])], right: [...(d.sinks.right ?? [])] }
            : d.sinks,
    };
}

function applyShoeSize(design: DesignState, shoe: RequiredShoeSize): DesignState | null {
    if (!Number.isFinite(shoe.value)) return null;
    if (shoe.system === "uk") {
        const layout = insoleLayoutForUkSize(shoe.value);
        return {
            ...design,
            sizeSystem: "uk",
            ukSize: layout.ukSize,
            usMenSize: ukToUsMen(layout.ukSize),
            footLengthMm: layout.footLengthMm,
        };
    }
    if (shoe.system === "mm") {
        const footLengthMm = normalizeFootLengthMm(shoe.value);
        const layout = insoleLayoutFromDesign({ sizeSystem: "mm", footLengthMm });
        return {
            ...design,
            sizeSystem: "mm",
            footLengthMm,
            usMenSize: layout.usMenSize,
            ukSize: usMenToUk(layout.usMenSize),
        };
    }
    const layout = insoleLayoutForUsMenSize(shoe.value);
    return {
        ...design,
        sizeSystem: "us",
        usMenSize: layout.usMenSize,
        ukSize: usMenToUk(layout.usMenSize),
        footLengthMm: layout.footLengthMm,
    };
}

function legacyArchBand(tier: ScanArchTierName): ArchBand {
    if (tier === "low") return "low";
    if (tier === "high") return "high";
    return "standard";
}

function placedArchLandmarks(markers: ScanMarkers | undefined): {
    heel: { x: number; y: number; z: number };
    m1: { x: number; y: number; z: number };
    m5: { x: number; y: number; z: number };
} | null {
    if (!markers?.M1 || !markers.M2 || !markers.M3) return null;
    return { heel: markers.M3, m1: markers.M1, m5: markers.M2 };
}

function writeSide(design: DesignState, side: Side, patch: SideCorrections): DesignState {
    const clamped = constrainSideCorrections(patch, design.thicknessMm).constrained;
    return {
        ...design,
        corrections: {
            ...design.corrections,
            linked: false,
            [side]: clamped,
        },
    };
}

/** Same object the Elements library writes in `addElement`, apart from the id. */
function placeElement(
    kind: ElementKind,
    side: Side,
    lengthMm: number,
    widthMm: number,
    n: number,
): PlacedElement {
    const pose = defaultElementPose(kind, side, lengthMm, widthMm);
    return {
        id: `one-click-${side}-${kind}-${n}`,
        kind,
        side,
        ...pose,
    };
}

/** Same object `addSink` writes. Depth is the library default unless the Rx names one. */
function placeSink(kind: SinkKind, depthMm: number | undefined, n: number): PlacedSink {
    return {
        id: `one-click-${kind}-${n}`,
        kind,
        depthMm: depthMm ?? SINK_DEFAULT_DEPTH_MM,
    };
}

/**
 * One-click generation. Shoe size scales the default SAMPLE_Top. The scan
 * contributes arch height only. Rx contributes explicit corrections, elements,
 * and sinks. Feet are independent. The input baseline is not mutated.
 */
export function generateOrthoticFromScanAndRx(input: GenerateOrthoticInput): GenerateOrthoticResult {
    const warnings: string[] = [];
    const reviewItems: string[] = [];

    if (!input.shoeSize || !Number.isFinite(input.shoeSize.value)) {
        return {
            ok: false,
            reason: "Shoe size is required. It is not taken from the scan.",
            failedStep: "shoe_size",
            warnings,
        };
    }
    if (input.scans.length === 0) {
        return { ok: false, reason: "Import at least one foot scan", failedStep: "scan", warnings };
    }

    let design = cloneDesignState(input.baselineDesign);
    const sized = applyShoeSize(design, input.shoeSize);
    if (!sized) {
        return {
            ok: false,
            reason: "Shoe size is required. It is not taken from the scan.",
            failedStep: "shoe_size",
            warnings,
        };
    }
    design = sized;
    const layout = insoleLayoutFromDesign(design);
    const sizeLabel =
        design.sizeSystem === "uk"
            ? `UK ${design.ukSize}`
            : design.sizeSystem === "mm"
              ? `${design.footLengthMm} mm`
              : `US men's ${design.usMenSize}`;

    const present = [...new Set(input.scans.map((s) => s.side))];
    const rx = interpretOneClickRx(input.prescriptionText ?? "", present);
    warnings.push(...rx.warnings);

    const designer = input.pathologyDesigner ?? stubPathologyDesigner;
    const pathology = rx.pathologyOnly
        ? designer.design({ text: input.prescriptionText ?? "", sides: present })
        : null;
    if (pathology) {
        warnings.push(pathology.reason);
        reviewItems.push(pathology.reason);
    } else if (rx.pathologyMentioned) {
        warnings.push("Pathology noted. Only explicit Rx corrections were applied.");
    }

    const perFoot: FootGenerationSummary[] = [];
    const rxElements: PlacedElement[] = [];
    const sinks: { left: PlacedSink[]; right: PlacedSink[] } = { left: [], right: [] };
    let seq = 0;

    for (const scan of input.scans) {
        if (scan.keepSetApproved === false) {
            return {
                ok: false,
                reason: "Approve the scan keep-set before generating",
                failedStep: "scan_cleanup",
                warnings,
            };
        }
        const landmarks = placedArchLandmarks(scan.markers);
        const manualApex =
            scan.archMarkerSource === "manual_override" && scan.markers?.ARCH ? scan.markers.ARCH : null;
        const measurement = measurePlantarArch({
            geometry: scan.geometry,
            side: scan.side,
            displayScale: scan.display.displayScale,
            landmarks,
            manualApex,
        });
        const rxText = input.prescriptionText ?? "";
        const explicitTier = explicitArchTierForSide(rxText, scan.side);
        const explicit = rx.correctionsBySide[scan.side] ?? {};
        const rxArchMm = Object.hasOwn(explicit, "archHeightMm");
        const rxArchOverride = rxArchMm || explicitTier != null;
        const scanClass = resolveScanArchAssignment({
            measurement,
            markerSource: manualApex ? "manual_override" : "scan_measured",
        });
        const resolved = resolveScanArchAssignment({
            measurement,
            markerSource: manualApex ? "manual_override" : "scan_measured",
            explicitArchHeightMm: rxArchMm ? (explicit.archHeightMm as number) : undefined,
            explicitTier,
            pathologyBlocksArchRaise: pathologyAsksToRaiseArch(rxText, scan.side),
        });
        for (const flag of resolved.record.reviewFlags) {
            const note = `${scan.side}: ${flag}`;
            warnings.push(note);
            reviewItems.push(note);
        }
        for (const warning of resolved.warnings) {
            warnings.push(`${scan.side}: ${warning}`);
        }

        const rxApexOverride = Object.hasOwn(explicit, "apexMoveMm");
        const flexible = input.flexibleBySide?.[scan.side] === true;
        // Slider values, not offsets. An explicit Rx number replaces the
        // scan tier or the Flexible +4. Nothing is added on top.
        const archHeightMm = resolved.record.archHeightDeltaMm;
        const apexMoveMm = rxApexOverride
            ? (explicit.apexMoveMm as number)
            : flexible
              ? FLEXIBLE_APEX_ANTERIOR_MM
              : 0;
        if (rxArchOverride) {
            warnings.push(
                `${scan.side}: Rx arch height overrides the ${legacyArchBand(scanClass.record.assignedArchTier)} scan class`,
            );
        }
        if (rxApexOverride && flexible) {
            warnings.push(
                `${scan.side}: Rx apex replaces the flexible apex. The slider is ${apexMoveMm} mm, not a sum.`,
            );
        }

        const forefootFromScan =
            landmarks &&
            measurement.forefootWidthMm != null &&
            !measurement.lowCoverage &&
            !Object.hasOwn(explicit, "forefootWidthMm")
                ? forefootWidthDeltaMm(measurement.forefootWidthMm, layout.widthMm)
                : undefined;
        const sidePatch: SideCorrections = {
            ...freshSide(),
            ...explicit,
            archHeightMm,
            apexMoveMm,
            ...(forefootFromScan !== undefined ? { forefootWidthMm: forefootFromScan } : {}),
            rearfootWedge: explicit.rearfootWedge,
            forefootWedge: explicit.forefootWedge,
            fullLengthWedge: explicit.fullLengthWedge,
        };
        design = writeSide(design, scan.side, sidePatch);
        design = {
            ...design,
            scanArchBySide: { ...design.scanArchBySide, [scan.side]: resolved.record },
        };

        for (const el of rx.elements) {
            if (el.side !== scan.side) continue;
            rxElements.push(placeElement(el.kind, el.side, layout.lengthMm, layout.widthMm, seq++));
        }
        for (const sink of rx.sinks) {
            if (sink.side !== scan.side) continue;
            if (sinks[sink.side].some((placed) => placed.kind === sink.kind)) continue;
            sinks[sink.side].push(placeSink(sink.kind, sink.depthMm, seq++));
        }

        perFoot.push({
            side: scan.side,
            archHeightMeasuredMm: measurement.measuredArchMm ?? 0,
            archBand: legacyArchBand(scanClass.record.assignedArchTier),
            archReviewBelow18:
                measurement.measuredArchMm != null &&
                measurement.measuredArchMm < 18 &&
                !measurement.lowCoverage,
            archHeightMm: design.corrections[scan.side].archHeightMm,
            apexMoveMm: design.corrections[scan.side].apexMoveMm,
            flexible,
            rxArchOverride,
            sizeLabel,
            scanArch: resolved.record,
        });
    }

    if (rx.elements.length > 0 || rx.sinks.length > 0) {
        const touched = new Set(present);
        const kept = (side: Side): PlacedSink[] | undefined => {
            const list = present.includes(side) ? sinks[side] : (design.sinks?.[side] ?? []);
            return list.length > 0 ? list : undefined;
        };
        const left = kept("left");
        const right = kept("right");
        design = {
            ...design,
            elements: [...design.elements.filter((e) => !touched.has(e.side)), ...rxElements],
            sinks: left || right ? { ...(left ? { left } : {}), ...(right ? { right } : {}) } : undefined,
        };
    }

    return { ok: true, design, warnings, reviewItems, perFoot, pathology };
}
