// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ProductionMethod, Side } from "@/types";
import type {
    AfoCastState,
    AfoClinicalMarkerId,
    AfoCorrections,
    AfoCrestState,
    AfoDesignMarkerId,
    AfoDesignState,
    AfoPrintMaterialId,
    AfoPrintParams,
    AfoReliefs,
    AfoScanWorkflow,
    AfoSideCorrection,
} from "./types";

/** Plantar / calcaneus Z in the oriented frame (C). */
export const AFO_C_MM = 0;
/** [K] Print wall thickness (mm). */
export const AFO_THICKNESS_MM = 4;
/** [K] Rim thickness (mm). Interior wall stays AFO_THICKNESS_MM. Windows app: 2.5. */
export const AFO_EDGE_MM = 2.5;
/** [K] Outward flare at the trim opening (mm). Windows app: 2.5. */
export const AFO_FLARE_MM = 2.5;
/**
 * Plantar footplate flare (mm). The opening uses {@link AFO_FLARE_MM};
 * the sole never flares more than this, matching the Windows footplate.
 */
export const AFO_FOOTPLATE_FLARE_CAP_MM = 1;
/** [K] Brace height from plantar origin when the fibular head is unknown (mm). */
export const AFO_BRACE_HEIGHT_MM = 220;
/** Proximal trim sits this far below the fibular head when height is automatic. */
export const AFO_BRACE_BELOW_FIBULA_MM = 22;
/** Hard warning when the trim is closer than this to the fibular head. */
export const AFO_BRACE_FIBULA_HARD_MM = 15;
/** [K] Taubin smooth iterations. */
export const AFO_SMOOTH_ITERATIONS = 6;
/** Rim band over which thickness blends from the wall to the edge (mm). */
export const AFO_RIM_BAND_MM = 10;
/** Print-step material ids. ApexVylon is the only AFO shell filament. */
export const AFO_PRINT_MATERIAL_IDS = ["ApexVylon"] as const satisfies readonly AfoPrintMaterialId[];
/** Default and only AFO print material. Founder spelling: ApexVylon. */
export const AFO_MATERIAL: AfoPrintMaterialId = "ApexVylon";

/**
 * AFO print accepts only ApexVylon. Saved settingsJson values such as PLA are ignored.
 */
export function coerceAfoPrintMaterial(value: unknown): AfoPrintMaterialId {
    const offered = AFO_PRINT_MATERIAL_IDS.find((id) => id === value);
    return offered ?? AFO_MATERIAL;
}

/** Fill print defaults and force the material onto ApexVylon. */
export function afoPrintParams(
    print?: (Partial<Omit<AfoPrintParams, "material">> & { material?: unknown }) | null,
): AfoPrintParams {
    return {
        thicknessMm: print?.thicknessMm ?? AFO_THICKNESS_MM,
        edgeMm: print?.edgeMm ?? AFO_EDGE_MM,
        flareMm: print?.flareMm ?? AFO_FLARE_MM,
        material: coerceAfoPrintMaterial(print?.material),
    };
}

export const AFO_FLATTEN_REMOVE_MM = 7;
export const AFO_FLATTEN_ADD_MM = 2.8;
export const AFO_FLATTEN_WARN_MM = 8;
export const AFO_SHIN_BOX_HEIGHT_MM = 100;
export const AFO_TOE_THICKNESS_MM = 0;
export const AFO_TOE_EXTRA_MM = 15;
export const AFO_REMOVE_CAST_DEFAULT = -2;
/** [K] Production method for a new AFO case. */
export const AFO_PRODUCTION_METHOD: ProductionMethod = "printing_shell";

export const AFO_FEATHER_MIN_MM = 10;
export const AFO_SLOPE_LIMIT = 0.7;
export const AFO_FEATHER_SLOPE = 2.15;
export const AFO_CREST_BAND_MM = 8;
export const AFO_CREST_SECTION_MM = 5;
export const AFO_CREST_OUTLIER_MM = 6;
export const AFO_CREST_OUTLIER_RATIO = 0.3;
export const AFO_CREST_PEAK_RATIO = 1.5;

/** [K] Canonical 3-point orient targets (heel, medial mal, lateral mal). */
export const AFO_ORIENT_TARGETS_MM: [number, number, number][] = [
    [0, 0, 0],
    [35, 40, 80],
    [-35, 40, 80],
];

export const AFO_THICKNESS_RANGE: [number, number] = [2.5, 6];
export const AFO_THICKNESS_WARN_MM = 2;
export const AFO_EDGE_RANGE: [number, number] = [1.5, 3];
export const AFO_FLARE_RANGE: [number, number] = [0, 4];
/**
 * Frontal varus (+) / valgus, degrees. Soft warnings still fire past ±5°.
 * No tighter clinical stop is documented for the slider.
 */
export const AFO_REAR_ROT_RANGE: [number, number] = [-30, 30];
/**
 * Sagittal dorsiflexion (+) / plantarflexion, degrees. Soft warnings still
 * fire outside −3° to +7°. No tighter clinical stop is documented for the slider.
 */
export const AFO_SIDE_ROT_RANGE: [number, number] = [-30, 30];
/** Signed heel offset (mm). Negative lowers the heel; the kernel adds this value. */
export const AFO_HEEL_LIFT_RANGE: [number, number] = [-20, 20];
export const AFO_HEEL_LIFT_WARN_MM = 12;
/** Signed toe offset (mm). Negative lowers the toes; the kernel adds this value. */
export const AFO_TOE_RISE_RANGE: [number, number] = [-15, 15];
export const AFO_FOOT_LIFT_RANGE: [number, number] = [0, 12];
/** Signed medial arch (mm). Negative lowers the arch; the kernel adds this value. */
export const AFO_ARCH_RANGE: [number, number] = [-8, 8];
export const AFO_ARCH_WARN_MM = 5;
export const AFO_HEEL_WIDTH_RANGE: [number, number] = [-4, 4];
export const AFO_VOLUME_OFFSET_RANGE: [number, number] = [-3, 10];
export const AFO_VOLUME_FEATHER_MM: [number, number] = [8, 12];
export const AFO_TEXT_DEPTH_MM: [number, number] = [0.4, 0.6];
export const AFO_SAGITTAL_WARN: [number, number] = [-3, 7];
export const AFO_BRACE_HEIGHT_RANGE: [number, number] = [80, 350];
export const AFO_SMOOTH_RANGE: [number, number] = [0, 12];
export const AFO_REMOVE_CAST_RANGE: [number, number] = [-10, 10];
export const AFO_SHIN_OFFSET_RANGE: [number, number] = [-6, 4];
export const AFO_TOE_BOX_PCT_RANGE: [number, number] = [100, 130];
export const AFO_RELIEF_RANGE: [number, number] = [-6, 0];

export const AFO_TRIM_MIN_POINTS = 3;
export const AFO_TRIM_MIN_LENGTH_MM = 20;
export const AFO_TRIM_MIN_AREA_MM2 = 100;
/** Close the loop by clicking the first pin inside this world radius. */
export const AFO_TRIM_CLOSE_MM = 3;
/** Close the loop when the click is this close to the first pin on screen. */
export const AFO_TRIM_CLOSE_PX = 10;
/** Drop a second pin that lands on an existing one. */
export const AFO_TRIM_DEDUPE_MM = 1;
/** Visible handle radius. The sphere is drawn with depth test off. */
export const AFO_TRIM_PIN_RADIUS_MM = 1.5;
/** Centripetal sample spacing along the trim. Never coarser than the max. */
export const AFO_TRIM_SAMPLE_MM = 0.5;
export const AFO_TRIM_SAMPLE_MAX_MM = 1;
/** Lift the drawn stroke off the surface so it does not z-fight. */
export const AFO_TRIM_DRAW_OFFSET_MM = 0.3;
/** Average face normals over this arc length before the display lift. */
export const AFO_TRIM_DISPLAY_NORMAL_MM = 4;
/** Reject a hit with no mesh point inside this distance. */
export const AFO_TRIM_PROJECT_MAX_MM = 3;
/** Local plane fit is allowed out to this distance when the mesh is farther than 3 mm. */
export const AFO_TRIM_PLANE_MAX_MM = 5;
export const AFO_TRIM_NORMAL_RAY_MM = 5;
/** Adjacent projected samples farther than this multiple of the spacing are subdivided. */
export const AFO_TRIM_JUMP_FACTOR = 3;

/**
 * Flat-plate trim, measured in the contact plane from the cast silhouette.
 *
 * An M10.5-scale sole is about 80 mm wide. One third of that width is the
 * lateral inset at midfoot, so the lateral line sits well inside the ragged
 * cast edge. The medial line stays close to the medial border through the
 * heel and midfoot, then sweeps across the forefoot. Heel and toe close on
 * arcs of at least {@link AFO_FLAT_TRIM_MIN_RADIUS_MM}, and a straight run
 * eases into those arcs over {@link AFO_FLAT_TRIM_BLEND_MM}.
 */
/** Fraction of the local plate width taken off the lateral cast edge. One third at midfoot. */
export const AFO_FLAT_TRIM_LATERAL_INSET_RATIO = 1 / 3;
/** Medial inset from the cast edge along the heel cup and midfoot (mm). */
export const AFO_FLAT_TRIM_MEDIAL_INSET_MM = 6;
/** Posterior inset of the heel U from the cast's posterior sole edge (mm). */
export const AFO_FLAT_TRIM_HEEL_INSET_MM = 10;
/**
 * Anterior inset of the toe closure (mm). This cuts off the flared toe tab
 * instead of tracing it.
 */
export const AFO_FLAT_TRIM_TOE_INSET_MM = 22;
/**
 * Minimum radius of curvature of the flat-plate trim (mm).
 * 15 mm is the floor on the plate. The default loop builds its fillets and
 * heel/toe caps at least 8 mm larger than this, so a straight run meeting an
 * arc does not show up as a short kink.
 */
export const AFO_FLAT_TRIM_MIN_RADIUS_MM = 15;
/**
 * Length of the straight run that leads into a heel or toe cap (mm).
 * The side meets the cap tangent to that run, over at least this distance.
 */
export const AFO_FLAT_TRIM_BLEND_MM = 25;
/**
 * Intended even break of the printed trim edge (mm). The cut itself follows
 * the smooth trim loop. Pulling sole vertices in by this amount adds
 * self-intersections on the plate, so the sole stays on the belt and this
 * value is the break to apply once that move can be made cleanly.
 */
export const AFO_FLAT_TRIM_CHAMFER_MM = 1;

export const AFO_DESIGN_MARKERS = [
    { id: "proximal_medial", label: "Proximal medial", view: "medial" },
    { id: "proximal_lateral", label: "Proximal lateral", view: "lateral" },
    { id: "malleolus_medial", label: "Medial malleolus", view: "medial" },
    { id: "malleolus_lateral", label: "Lateral malleolus", view: "lateral" },
    { id: "distal", label: "Distal / sulcus", view: "bottom" },
] as const;

export const AFO_CLINICAL_MARKERS: {
    id: AfoClinicalMarkerId;
    label: string;
    view: "medial" | "lateral" | "front";
}[] = [
    { id: "navicular", label: "Navicular", view: "medial" },
    { id: "fifth_met_base", label: "5th met base", view: "lateral" },
    { id: "post_calcaneus", label: "Post calcaneus", view: "medial" },
    { id: "fibular_head", label: "Fibular head", view: "lateral" },
    { id: "tibial_tuberosity", label: "Tibial tuberosity", view: "front" },
    { id: "distal_crest", label: "Distal crest end", view: "front" },
];

export type { AfoDesignMarkerId };

export function defaultAfoSideCorrection(): AfoSideCorrection {
    return {
        legRearDeg: 0,
        legSideDeg: 0,
        heelLiftMm: 0,
        footLiftMedMm: 0,
        footLiftLatMm: 0,
        medialArchMm: 0,
        heelWidthMm: 0,
        braceHeightMm: AFO_BRACE_HEIGHT_MM,
        toeRiseMm: 0,
    };
}

export function defaultAfoCorrections(): AfoCorrections {
    const side = defaultAfoSideCorrection();
    return {
        ...side,
        smoothIterations: AFO_SMOOTH_ITERATIONS,
        left: { ...side },
        right: { ...side },
        volumeRegions: [],
        smoothRegions: [],
        text: null,
        patientName: "PATIENT",
    };
}

/**
 * Store a clinical correction on one side. Both (linked) copies that same
 * clinical value onto the other side — varus stays varus, not a world-axis sign.
 * Other fields on the untouched side stay put. `promote` mirrors the edited
 * side onto the legacy top-level fields (the foot currently shown).
 */
export function writeAfoSideCorrection(
    c: AfoCorrections,
    editSide: "left" | "right",
    partial: Partial<AfoSideCorrection>,
    opts: { linked: boolean; promote: boolean },
): AfoCorrections {
    const leftBase = c.left ?? c;
    const rightBase = c.right ?? c;
    const nextEdited = { ...(editSide === "right" ? rightBase : leftBase), ...partial };
    const left = editSide === "left" ? nextEdited : opts.linked ? { ...leftBase, ...partial } : leftBase;
    const right = editSide === "right" ? nextEdited : opts.linked ? { ...rightBase, ...partial } : rightBase;
    return {
        ...c,
        ...(opts.promote ? nextEdited : {}),
        left,
        right,
    };
}

/** Copy one side's numbers onto the top-level fields. Smooth stays shared. */
export function correctionsForSide(c: AfoCorrections, side: "left" | "right"): AfoCorrections {
    const values = side === "right" ? (c.right ?? c) : (c.left ?? c);
    return {
        ...c,
        ...values,
        smoothIterations: c.smoothIterations,
        left: c.left,
        right: c.right,
        volumeRegions: c.volumeRegions ?? [],
        smoothRegions: c.smoothRegions ?? [],
        text: c.text ?? null,
        patientName: c.patientName ?? "PATIENT",
    };
}

export function defaultAfoReliefs(): AfoReliefs {
    return {
        malleoli: { mm: -3, on: true },
        navicular: { mm: -2, on: false },
        fifthMetBase: { mm: -2, on: false },
        postCalcaneus: { mm: -2, on: false },
        fibularHead: { mm: -2, on: false },
    };
}

export function defaultAfoCrest(): AfoCrestState {
    return {
        points: [],
        outlierRatio: 0,
        peakToMedian: 1,
        lowConfidence: false,
        override: false,
    };
}

export function defaultAfoCast(): AfoCastState {
    return {
        removeCastMm: AFO_REMOVE_CAST_DEFAULT,
        shinOffsetMm: 0,
        insensate: false,
        flattenBottom: false,
        flattenRemoveMm: AFO_FLATTEN_REMOVE_MM,
        flattenAddMm: AFO_FLATTEN_ADD_MM,
        shinBox: { widthMm: 80, depthMm: 70, heightMm: AFO_SHIN_BOX_HEIGHT_MM, enabled: false },
        toeBox: {
            widthMm: 80,
            depthMm: 90,
            heightMm: 50,
            heightPct: 100,
            thicknessMm: AFO_TOE_THICKNESS_MM,
            extraLengthMm: AFO_TOE_EXTRA_MM,
            enabled: false,
        },
        transparent: false,
        show3dModel: true,
        showCorrected: false,
    };
}

export function defaultAfoPrint(): AfoPrintParams {
    return afoPrintParams(null);
}

export function defaultAfoScanWorkflow(): AfoScanWorkflow {
    return {
        scanId: null,
        displayScale: 1,
        plantar: {},
        alignmentApplied: false,
        levelToRearfoot: false,
        matrixElements: null,
        landmarks: {},
        skippedLandmarks: [],
        derived: null,
    };
}

export function defaultAfoDesignState(side: Side = "left"): AfoDesignState {
    return {
        side,
        method: AFO_PRODUCTION_METHOD,
        cast: defaultAfoCast(),
        corrections: defaultAfoCorrections(),
        reliefs: defaultAfoReliefs(),
        clinicalMarkers: [],
        crest: defaultAfoCrest(),
        effectiveFeatherMm: AFO_FEATHER_MIN_MM,
        landmarks: [],
        scanWorkflow: defaultAfoScanWorkflow(),
        trimPoints: [],
        trimCurve: [],
        trimClosed: false,
        trimConfirmed: false,
        print: defaultAfoPrint(),
        flatAfo: null,
        shellReady: false,
    };
}

export function isAfoIdentityCorrections(c: AfoCorrections): boolean {
    return (
        c.legRearDeg === 0 &&
        c.legSideDeg === 0 &&
        c.heelLiftMm === 0 &&
        c.footLiftMedMm === 0 &&
        c.footLiftLatMm === 0 &&
        c.medialArchMm === 0 &&
        c.heelWidthMm === 0 &&
        (c.toeRiseMm ?? 0) === 0 &&
        c.smoothIterations === 0 &&
        (c.volumeRegions?.length ?? 0) === 0 &&
        (c.smoothRegions?.length ?? 0) === 0 &&
        !c.text?.text
    );
}
