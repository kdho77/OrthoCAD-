// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import { transformAfoPoint } from "./landmark-frame";
import { meshProjector, nearestVertex, vertexCount } from "./mesh-ops";
import type { AfoAnatomicalLandmarkId, AfoDesignState, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Closed-back balance brace. Every number the expert fixed lives here so it
 * can be tuned without hunting through the curve builder.
 * Oriented frame: +X anterior, +Z up, medial = medialSign.
 */
export const BALANCE_BRACE_PRESET = {
    anteriorOffsetAtMalleolusMm: 10,
    anteriorBlendAboveMalleolusMm: 40,
    calfApFraction: 0.5,
    tibialCrestClearanceMm: 15,
    lateralBrimBelowFhMm: 25,
    medialBrimDropMm: 10,
    posteriorMidlineDropMm: 5,
    brimCornerRadiusMm: 12,
    fhFallbackAboveAjcMm: 110,
    wallHeelMm: 15,
    wallMetMm: 8,
    wallToeMm: 3,
    navDipMm: 10,
    navRecoverMm: 12,
    navRecoverFraction: 0.55,
    navEstimateFraction: 0.425,
    fifthMetDipMm: 8,
    lateralOutsideM5Mm: 3,
    toeRoundRadiusMm: 15,
    reliefClearanceMm: 8,
    sampleMm: 2,
    maxSurfaceDeviationMm: 1,
    controlsPerSide: 24,
    maxTurnDeg: 20,
    ankleConcaveRadiusMm: 20,
    heelRadiusMm: 25,
    convexRadiusMm: 8,
    concaveRadiusMm: 10,
    malleolusSpanMinMm: 55,
    malleolusSpanMaxMm: 85,
    ajcHeightMinMm: 55,
    ajcHeightMaxMm: 110,
    fhAboveAjcMinMm: 180,
} as const;

export interface BalanceBraceFlag {
    id: string;
    message: string;
}

export interface BalanceBracePresetIssue {
    id: string;
    label: string;
    kind: "missing" | "implausible";
}

export interface BalanceBracePopup {
    title: string;
    message: string;
    issues: BalanceBracePresetIssue[];
    /** A fallback exists, so the user can continue without placing the point. */
    canContinue: boolean;
}

export interface BalanceBracePresetResult {
    pins: AfoVec3[];
    /** Dense on-cast loop. The first point is repeated at the end when closed. */
    curve: AfoVec3[];
    flags: BalanceBraceFlag[];
    popup: BalanceBracePopup | null;
    /** A loop was written. Missing required markers leave this false and do not throw. */
    placed: boolean;
    controlsPerSide: { medial: number; lateral: number };
    maxTurnDeg: number;
    maxSurfaceDeviationMm: number;
}

export interface BalanceBracePresetOptions {
    /** Use AJC + 110 mm when the fibular head is missing, and keep estimated navicular. */
    continueWithFallbacks?: boolean;
}

type SideName = "medial" | "lateral";

interface Seg {
    a: AfoVec3;
    b: AfoVec3;
}

interface ResolvedMarkers {
    mm: AfoVec3;
    lm: AfoVec3;
    ajc: AfoVec3;
    fh: AfoVec3 | null;
    m1: AfoVec3;
    m5: AfoVec3;
    hc: AfoVec3;
    tt: AfoVec3;
    nav: AfoVec3 | null;
    fifth: AfoVec3 | null;
    extraLengthMm: number;
}

const P = BALANCE_BRACE_PRESET;

export function balanceBracePresetTable(): { id: string; label: string; value: string }[] {
    return [
        { id: "anterior", label: "Anterior of each malleolus", value: `${P.anteriorOffsetAtMalleolusMm} mm` },
        { id: "blend", label: "Blend above the malleolus", value: `${P.anteriorBlendAboveMalleolusMm} mm` },
        {
            id: "calf",
            label: "Calf anterior edge",
            value: `${Math.round(P.calfApFraction * 100)}% of A-P depth`,
        },
        { id: "crest", label: "Posterior to the tibial crest", value: `≥ ${P.tibialCrestClearanceMm} mm` },
        { id: "lat-brim", label: "Lateral brim below fibular head", value: `${P.lateralBrimBelowFhMm} mm` },
        { id: "med-brim", label: "Medial brim below the lateral", value: `${P.medialBrimDropMm} mm` },
        { id: "post", label: "Posterior midline below the chord", value: `${P.posteriorMidlineDropMm} mm` },
        {
            id: "fh-fallback",
            label: "Brim if fibular head is missing",
            value: `AJC + ${P.fhFallbackAboveAjcMm} mm`,
        },
        { id: "corner", label: "Anterior brim corner radius", value: `≥ ${P.brimCornerRadiusMm} mm` },
        { id: "heel-wall", label: "Wall at the heel", value: `${P.wallHeelMm} mm` },
        { id: "met-wall", label: "Wall at the M1–M5 line", value: `${P.wallMetMm} mm` },
        { id: "toe-wall", label: "Wall at the toe", value: `${P.wallToeMm} mm` },
        { id: "nav", label: "Medial wall at the navicular", value: `${P.navDipMm} mm` },
        { id: "nav-back", label: "Medial wall at 55% of foot length", value: `${P.navRecoverMm} mm` },
        { id: "styloid", label: "5th-met clearance dip", value: `${P.fifthMetDipMm} mm` },
        { id: "m5", label: "Lateral of M5", value: `${P.lateralOutsideM5Mm} mm` },
        { id: "toe-r", label: "Toe round radius", value: `≥ ${P.toeRoundRadiusMm} mm` },
        { id: "relief", label: "Clearance from relief markers", value: `≥ ${P.reliefClearanceMm} mm` },
        { id: "sample", label: "Resample", value: `${P.sampleMm} mm` },
        { id: "turn", label: "Max turn per sample", value: `${P.maxTurnDeg}°` },
    ];
}

export function buildBalanceBracePreset(
    mesh: AfoTriMesh,
    afo: AfoDesignState,
    options: BalanceBracePresetOptions = {},
): BalanceBracePresetResult {
    const empty = (popup: BalanceBracePopup | null, flags: BalanceBraceFlag[]): BalanceBracePresetResult => ({
        pins: [],
        curve: [],
        flags,
        popup,
        placed: false,
        controlsPerSide: { medial: 0, lateral: 0 },
        maxTurnDeg: 0,
        maxSurfaceDeviationMm: 0,
    });
    try {
        const resolved = resolveMarkers(mesh, afo);
        const flags = plausibilityFlags(mesh, afo.side, resolved);
        const missing = missingIssues(resolved);
        const implausible = flags
            .filter((flag) => flag.id !== "nav-estimated" && flag.id !== "fh-fallback")
            .map((flag) => ({ id: flag.id, label: flag.message, kind: "implausible" as const }));
        if (
            missing.length > 0 &&
            !(options.continueWithFallbacks && missing.every((item) => item.id === "fibular_head"))
        ) {
            return empty(
                {
                    title: "Place the balance-brace markers",
                    message:
                        "The trimline needs these points. Place the missing one and click the preset again. Nothing else is blocked.",
                    issues: missing,
                    canContinue: missing.every((item) => item.id === "fibular_head"),
                },
                flags,
            );
        }
        if (!resolved.mm || !resolved.lm || !resolved.m1 || !resolved.m5 || !resolved.hc || !resolved.tt) {
            return empty(
                {
                    title: "Place the balance-brace markers",
                    message: "A required marker is still missing.",
                    issues: missing,
                    canContinue: false,
                },
                flags,
            );
        }
        const built = buildLoop(mesh, afo.side, {
            mm: resolved.mm,
            lm: resolved.lm,
            ajc: resolved.ajc!,
            fh: resolved.fh,
            m1: resolved.m1,
            m5: resolved.m5,
            hc: resolved.hc,
            tt: resolved.tt,
            nav: resolved.nav,
            fifth: resolved.fifth,
            extraLengthMm: resolved.extraLengthMm,
        });
        const popup =
            implausible.length > 0
                ? {
                      title: "Check these markers",
                      message:
                          "The trimline was placed. These measurements look off — move the marker and click the preset again if you want it rebuilt.",
                      issues: implausible,
                      canContinue: true,
                  }
                : null;
        return { ...built, flags, popup, placed: built.curve.length >= 8 };
    } catch (error) {
        const message = error instanceof Error ? error.message : "The preset could not read these markers.";
        return empty(
            {
                title: "Place the balance-brace markers",
                message,
                issues: [{ id: "preset", label: message, kind: "missing" }],
                canContinue: false,
            },
            [],
        );
    }
}

interface PartialMarkers {
    mm?: AfoVec3;
    lm?: AfoVec3;
    ajc?: AfoVec3;
    fh: AfoVec3 | null;
    m1?: AfoVec3;
    m5?: AfoVec3;
    hc?: AfoVec3;
    tt?: AfoVec3;
    nav: AfoVec3 | null;
    fifth: AfoVec3 | null;
    extraLengthMm: number;
    navEstimated: boolean;
    fhFallback: boolean;
}

function resolveMarkers(mesh: AfoTriMesh, afo: AfoDesignState): PartialMarkers {
    const scan = afo.scanWorkflow;
    const orient = (p: AfoVec3 | undefined): AfoVec3 | undefined => {
        if (!p) return undefined;
        if (scan.alignmentApplied && scan.matrixElements) return transformAfoPoint(p, scan.matrixElements);
        return p;
    };
    const landmark = (id: AfoAnatomicalLandmarkId) => orient(scan.landmarks[id]);
    const design = (id: AfoDesignState["landmarks"][number]["id"]) =>
        afo.landmarks.find((item) => item.id === id)?.point;
    const clinical = (id: string) => afo.clinicalMarkers.find((item) => item.id === id)?.point;
    const mm = landmark("medial_malleolus") ?? design("malleolus_medial");
    const lm = landmark("lateral_malleolus") ?? design("malleolus_lateral");
    const fh = landmark("fibular_head") ?? clinical("fibular_head") ?? null;
    const m1 = landmark("m1_mpj") ?? orient(scan.plantar.m1p);
    const m5 = landmark("m5_mpj") ?? orient(scan.plantar.m5p);
    const hc = orient(scan.plantar.heel) ?? landmark("posterior_calcaneus") ?? clinical("post_calcaneus");
    const tt = landmark("toe_tip");
    let nav = landmark("navicular") ?? clinical("navicular") ?? null;
    const fifth = landmark("fifth_met_base") ?? clinical("fifth_met_base") ?? null;
    const ajc = mm && lm ? mid(mm, lm) : undefined;
    let navEstimated = false;
    if (!nav && hc && tt && mm) {
        nav = estimateNavicular(mesh, afo.side, hc, tt, mm);
        navEstimated = nav != null;
    }
    return {
        mm,
        lm,
        ajc,
        fh,
        m1,
        m5,
        hc,
        tt,
        nav,
        fifth,
        extraLengthMm: afo.cast.toeBox.extraLengthMm ?? 15,
        navEstimated,
        fhFallback: !fh,
    };
}

function missingIssues(markers: PartialMarkers): BalanceBracePresetIssue[] {
    const rows: { id: string; label: string; ok: boolean }[] = [
        { id: "medial_malleolus", label: "Medial malleolus", ok: Boolean(markers.mm) },
        { id: "lateral_malleolus", label: "Lateral malleolus", ok: Boolean(markers.lm) },
        { id: "m1_mpj", label: "1st met head", ok: Boolean(markers.m1) },
        { id: "m5_mpj", label: "5th met head", ok: Boolean(markers.m5) },
        { id: "heel", label: "Heel center", ok: Boolean(markers.hc) },
        { id: "toe_tip", label: "Toe tip", ok: Boolean(markers.tt) },
        { id: "fibular_head", label: "Fibular head", ok: Boolean(markers.fh) },
    ];
    return rows
        .filter((row) => !row.ok)
        .map((row) => ({ id: row.id, label: row.label, kind: "missing" as const }));
}

function plausibilityFlags(mesh: AfoTriMesh, side: Side, markers: PartialMarkers): BalanceBraceFlag[] {
    const flags: BalanceBraceFlag[] = [];
    if (markers.navEstimated) {
        flags.push({
            id: "nav-estimated",
            message: `Navicular was estimated at ${Math.round(P.navEstimateFraction * 100)}% of foot length on the medial contour.`,
        });
    }
    if (markers.mm && markers.lm) {
        const span = dist(markers.mm, markers.lm);
        if (span < P.malleolusSpanMinMm || span > P.malleolusSpanMaxMm) {
            flags.push({
                id: "malleolus-span",
                message: `Malleoli are ${span.toFixed(0)} mm apart (expected ${P.malleolusSpanMinMm}–${P.malleolusSpanMaxMm} mm).`,
            });
        }
    }
    if (markers.ajc && markers.hc) {
        const plantar = soleZ(mesh, markers.hc);
        const height = markers.ajc.z - plantar;
        if (height < P.ajcHeightMinMm || height > P.ajcHeightMaxMm) {
            flags.push({
                id: "ajc-height",
                message: `Ankle-joint height is ${height.toFixed(0)} mm (expected ${P.ajcHeightMinMm}–${P.ajcHeightMaxMm} mm).`,
            });
        }
    }
    if (!markers.fh && markers.ajc) {
        flags.push({
            id: "fh-fallback",
            message: `Fibular head is missing. The lateral brim uses the ankle joint + ${P.fhFallbackAboveAjcMm} mm.`,
        });
    }
    if (markers.fh && markers.ajc) {
        const rise = markers.fh.z - markers.ajc.z;
        if (rise < P.fhAboveAjcMinMm) {
            flags.push({
                id: "fh-height",
                message: `Fibular head is ${rise.toFixed(0)} mm above the ankle joint (expected at least ${P.fhAboveAjcMinMm} mm).`,
            });
        }
    }
    void side;
    return flags;
}

function buildLoop(
    mesh: AfoTriMesh,
    foot: Side,
    markers: ResolvedMarkers,
): Omit<BalanceBracePresetResult, "flags" | "popup" | "placed"> {
    const slices = new Map<number, Seg[]>();
    const slice = (z: number): Seg[] => {
        const key = Math.round(z * 4) / 4;
        const hit = slices.get(key);
        if (hit) return hit;
        const segs = horizontalSegments(mesh, key);
        slices.set(key, segs);
        return segs;
    };
    const plantar = soleZ(mesh, markers.hc);
    const forward = footForward(markers.hc, markers.tt);
    const length = Math.max(1, dist(markers.hc, { ...markers.tt, z: markers.hc.z }));
    const sOf = (p: AfoVec3) =>
        ((p.x - markers.hc.x) * forward.x + (p.y - markers.hc.y) * forward.y) / length;
    const sMet = Math.min(0.9, Math.max(0.45, (sOf(markers.m1) + sOf(markers.m5)) * 0.5));
    const sNav = markers.nav ? clamp(sOf(markers.nav), 0.2, 0.7) : P.navEstimateFraction;
    const sFifth = markers.fifth ? clamp(sOf(markers.fifth), 0.25, 0.85) : null;
    const sM5 = clamp(sOf(markers.m5), 0.4, 0.92);
    const zLat = markers.fh ? markers.fh.z - P.lateralBrimBelowFhMm : markers.ajc.z + P.fhFallbackAboveAjcMm;
    const zMed = zLat - P.medialBrimDropMm;
    const zPost = (zLat + zMed) * 0.5 - P.posteriorMidlineDropMm;

    const extent = (z: number) => {
        const segs = slice(z);
        let xMin = Infinity;
        let xMax = -Infinity;
        for (const seg of segs) {
            xMin = Math.min(xMin, seg.a.x, seg.b.x);
            xMax = Math.max(xMax, seg.a.x, seg.b.x);
        }
        if (!Number.isFinite(xMin)) return { xMin: markers.ajc.x - 20, xMax: markers.ajc.x + 20 };
        return { xMin, xMax };
    };
    const anteriorX = (z: number, mal: AfoVec3) => {
        const box = extent(z);
        const mid = box.xMin + (box.xMax - box.xMin) * P.calfApFraction;
        const offset = mal.x + P.anteriorOffsetAtMalleolusMm;
        const blend = P.anteriorBlendAboveMalleolusMm;
        let x: number;
        if (z <= mal.z) x = offset;
        else if (z >= mal.z + blend) x = mid;
        else x = lerpNum(offset, mid, smoother((z - mal.z) / blend));
        return Math.min(x, box.xMax - P.tibialCrestClearanceMm);
    };
    const atX = (z: number, x: number, side: SideName): AfoVec3 => {
        const segs = slice(z);
        let found = pointOnSideAtX(segs, x, side, foot);
        if (!found) {
            for (let d = 1; d <= 14 && !found; d += 1) {
                found = pointOnSideAtX(segs, x - d, side, foot) ?? pointOnSideAtX(segs, x + d, side, foot);
            }
        }
        if (found) return found;
        const mal = side === "medial" ? markers.mm : markers.lm;
        return { x, y: mal.y, z };
    };
    const wall = (s: number, side: SideName) => wallHeight(s, side, sMet, sNav, sFifth);
    const atStation = (s: number, side: SideName): AfoVec3 => {
        const zWant = plantar + wall(s, side);
        const along = add(markers.hc, scale(forward, s * length));
        // A low slice of a rounded foot shrinks to the midline and kinks the
        // rail. Climb until the station is still on the side wall.
        let hit: AfoVec3 | null = null;
        for (let z = zWant; z <= zWant + 16; z += 1.5) {
            const candidate = pointOnSideAtX(slice(z), along.x, side, foot);
            if (candidate && sideScore(candidate.y, side, foot) > 8) {
                hit = candidate;
                break;
            }
        }
        if (!hit) {
            const segs = slice(zWant);
            hit = pointOnSideAtStation(segs, along.x, s, sOf, side, foot);
        }
        return hit ?? { x: along.x, y: side === "medial" ? markers.m1.y : markers.m5.y, z: zWant };
    };

    const heelS = 0.04;
    const toeS = 0.9;
    const latHeel = atStation(heelS, "lateral");
    const medHeel = atStation(heelS, "medial");
    latHeel.z = plantar + P.wallHeelMm;
    medHeel.z = plantar + P.wallHeelMm;

    const leg = (side: SideName, zTop: number, mal: AfoVec3) => {
        const holdBottom = Math.max(plantar + P.wallHeelMm + P.heelRadiusMm * 0.65, mal.z - 36);
        const top = zTop - P.brimCornerRadiusMm;
        const zs = new Set<number>([holdBottom, mal.z, top]);
        for (let z = holdBottom; z <= top; z += 9) zs.add(z);
        return [...zs].sort((a, b) => a - b).map((z) => atX(z, anteriorX(z, mal), side));
    };
    const latLeg = leg("lateral", zLat, markers.lm);
    const medLeg = leg("medial", zMed, markers.mm);
    const latMal = atX(markers.lm.z, markers.lm.x + P.anteriorOffsetAtMalleolusMm, "lateral");
    const medMal = atX(markers.mm.z, markers.mm.x + P.anteriorOffsetAtMalleolusMm, "medial");
    replaceNearest(latLeg, latMal);
    replaceNearest(medLeg, medMal);

    const footChain = (side: SideName) => {
        const pts: AfoVec3[] = [];
        const steps = 12;
        for (let i = 1; i <= steps; i += 1) {
            const s = heelS + ((toeS - heelS) * i) / steps;
            const p = atStation(s, side);
            if (side === "lateral") {
                // The lateral border finishes 3 mm outside M5, blended so the
                // offset does not put a single-sample kink in the rail.
                const weight = Math.exp(-((s - sM5) ** 2) / (2 * 0.045 * 0.045));
                const sign = -medialSign(foot);
                const shifted = { ...p, y: p.y + sign * P.lateralOutsideM5Mm * weight };
                const snap = meshProjector(mesh).closest(shifted);
                pts.push(snap.errorMm <= P.maxSurfaceDeviationMm ? snap.point : p);
            } else {
                pts.push(p);
            }
        }
        return pts;
    };
    const latFoot = footChain("lateral");
    const medFoot = footChain("medial");

    const latCorner = atX(zLat, anteriorX(zLat, markers.lm), "lateral");
    const medCorner = atX(zMed, anteriorX(zMed, markers.mm), "medial");
    const latAround = walkTowardPosterior(slice, latCorner, P.brimCornerRadiusMm, foot);
    const medAround = walkTowardPosterior(slice, medCorner, P.brimCornerRadiusMm, foot);
    const latFillet = filletPoints(latLeg[latLeg.length - 1]!, latCorner, latAround, P.brimCornerRadiusMm);
    const medFillet = filletPoints(medLeg[medLeg.length - 1]!, medCorner, medAround, P.brimCornerRadiusMm);
    const latHeelFillet = filletPoints(latLeg[0]!, latHeel, latFoot[0]!, P.heelRadiusMm);
    const medHeelFillet = filletPoints(medLeg[0]!, medHeel, medFoot[0]!, P.heelRadiusMm);
    const brim = brimArc(slice, latAround, medAround, zLat, zMed, zPost, foot);
    const toe = toeRound(
        markers.tt,
        forward,
        markers.extraLengthMm,
        plantar,
        latFoot[latFoot.length - 1]!,
        medFoot[medFoot.length - 1]!,
    );

    const open = dedupe([
        ...latFoot,
        ...toe,
        ...[...medFoot].reverse(),
        ...[...medHeelFillet].reverse(),
        ...medLeg,
        ...medFillet,
        // The arc is built lateral-to-medial. The loop arrives on the medial
        // edge, so travel it medial-to-lateral and meet the lateral fillet.
        ...[...brim].reverse(),
        ...[...latFillet].reverse(),
        ...[...latLeg].reverse(),
        ...latHeelFillet,
    ]);
    const pinned = [
        latMal,
        medMal,
        latAround,
        medAround,
        brim[Math.floor(brim.length / 2)]!,
        toe[Math.floor(toe.length / 2)]!,
    ];
    const resampled = resampleOpen(open.length >= 8 ? open : pinned, P.sampleMm);
    restorePinned(resampled, pinned);
    const projector = meshProjector(mesh);
    const toeApex = toe[Math.floor(toe.length / 2)]!;
    let faired = resampled.map((p) => ({ ...p }));
    for (let pass = 0; pass < 6; pass += 1) {
        faired = fairOnSurface(faired, projector, pinned, toeApex);
        restorePinned(faired, pinned);
    }
    relaxRadius(faired, pinned, plantar, markers);
    restorePinned(faired, pinned);
    pushOffReliefs(
        faired,
        pinned,
        [markers.mm, markers.lm, markers.nav, markers.fifth, markers.fh].filter(Boolean) as AfoVec3[],
    );
    restorePinned(faired, pinned);
    const curve = resampleOpen(faired, P.sampleMm);
    restorePinned(curve, pinned);
    limitTurn(curve, pinned, toeApex);
    const lateralPins = controlsAlong(curve, "lateral", foot, P.controlsPerSide, [
        latMal,
        latAround,
        latHeel,
    ]);
    const medialPins = controlsAlong(curve, "medial", foot, P.controlsPerSide, [medMal, medAround, medHeel]);
    const pins = dedupe([...lateralPins, ...medialPins]);
    const ring = curve.length > 2 ? [...curve, { ...curve[0]! }] : curve;
    return {
        pins,
        curve: ring,
        controlsPerSide: { medial: medialPins.length, lateral: lateralPins.length },
        maxTurnDeg: maxTurn(curve),
        maxSurfaceDeviationMm: surfaceDeviation(projector, curve, toeApex),
    };
}

function wallHeight(s: number, side: SideName, sMet: number, sNav: number, sFifth: number | null): number {
    const met = clamp(sMet, 0.35, 0.9);
    if (side === "medial") {
        const nav = clamp(Math.min(sNav, met - 0.08), 0.15, met - 0.05);
        const recover = clamp(Math.max(P.navRecoverFraction, nav + 0.06), nav + 0.04, met - 0.02);
        if (s <= nav) return lerpNum(P.wallHeelMm, P.navDipMm, smoother(s / nav));
        if (s <= recover) return lerpNum(P.navDipMm, P.navRecoverMm, smoother((s - nav) / (recover - nav)));
        if (s <= met) return lerpNum(P.navRecoverMm, P.wallMetMm, smoother((s - recover) / (met - recover)));
        return lerpNum(P.wallMetMm, P.wallToeMm, smoother((s - met) / Math.max(1e-3, 1 - met)));
    }
    const base =
        s <= met
            ? lerpNum(P.wallHeelMm, P.wallMetMm, smoother(s / met))
            : lerpNum(P.wallMetMm, P.wallToeMm, smoother((s - met) / Math.max(1e-3, 1 - met)));
    if (sFifth == null) return base;
    const sigma = 0.055;
    const weight = Math.exp(-((s - sFifth) ** 2) / (2 * sigma * sigma));
    return Math.max(P.wallToeMm, base - P.fifthMetDipMm * weight);
}

function brimArc(
    slice: (z: number) => Seg[],
    lateral: AfoVec3,
    medial: AfoVec3,
    zLat: number,
    zMed: number,
    zPost: number,
    foot: Side,
): AfoVec3[] {
    const pts: AfoVec3[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i += 1) {
        const u = i / steps;
        const z = lerpNum(zLat, zMed, u) - P.posteriorMidlineDropMm * Math.sin(Math.PI * u);
        if (i === 0) {
            pts.push({ ...lateral, z: zLat });
            continue;
        }
        if (i === steps) {
            pts.push({ ...medial, z: zMed });
            continue;
        }
        const segs = slice(z);
        const center = sectionCenter(segs, lateral, medial);
        const ang = sweepAngle(lateral, medial, center, u);
        const hit = rayOutline(segs, center, ang);
        pts.push(hit ?? { x: lerpNum(lateral.x, medial.x, u), y: lerpNum(lateral.y, medial.y, u), z });
    }
    const mid = pts[Math.floor(steps / 2)]!;
    mid.z = zPost;
    void foot;
    return pts;
}

function toeRound(
    tt: AfoVec3,
    forward: AfoVec3,
    extra: number,
    plantar: number,
    lateralEnd: AfoVec3,
    medialEnd: AfoVec3,
): AfoVec3[] {
    const apex = add(tt, scale(forward, Math.max(0, extra)));
    apex.z = plantar + P.wallToeMm;
    const half = Math.max(P.toeRoundRadiusMm, dist(lateralEnd, medialEnd) * 0.5);
    const radius = Math.max(P.toeRoundRadiusMm, half);
    const center = sub(apex, scale(forward, radius));
    center.z = apex.z;
    let side = { x: -forward.y, y: forward.x, z: 0 };
    const latSign = lateralEnd.y - medialEnd.y >= 0 ? 1 : -1;
    if (side.y * latSign < 0) side = scale(side, -1);
    const pts: AfoVec3[] = [];
    const steps = 10;
    for (let i = 1; i < steps; i += 1) {
        const theta = Math.PI / 2 - (Math.PI * i) / steps;
        pts.push({
            x: center.x + side.x * Math.sin(theta) * radius + forward.x * Math.cos(theta) * radius,
            y: center.y + side.y * Math.sin(theta) * radius + forward.y * Math.cos(theta) * radius,
            z: apex.z,
        });
    }
    return pts;
}

function estimateNavicular(
    mesh: AfoTriMesh,
    foot: Side,
    hc: AfoVec3,
    tt: AfoVec3,
    mm: AfoVec3,
): AfoVec3 | null {
    const forward = footForward(hc, tt);
    const length = Math.max(1, dist(hc, { ...tt, z: hc.z }));
    const s = P.navEstimateFraction;
    const at = add(hc, scale(forward, s * length));
    const z = mm.z > hc.z ? hc.z + 12 : hc.z + 8;
    const segs = horizontalSegments(mesh, z);
    return pointOnSideAtX(segs, at.x, "medial", foot);
}

function horizontalSegments(mesh: AfoTriMesh, z: number): Seg[] {
    const segs: Seg[] = [];
    const idx = mesh.indices;
    const pos = mesh.positions;
    const n = (idx.length / 3) | 0;
    for (let t = 0; t < n; t += 1) {
        const ids = [idx[t * 3] ?? 0, idx[t * 3 + 1] ?? 0, idx[t * 3 + 2] ?? 0];
        const vs = ids.map((i) => ({
            x: pos[i * 3] ?? 0,
            y: pos[i * 3 + 1] ?? 0,
            z: pos[i * 3 + 2] ?? 0,
        }));
        const hits: AfoVec3[] = [];
        for (let e = 0; e < 3; e += 1) {
            const a = vs[e]!;
            const b = vs[(e + 1) % 3]!;
            if (a.z < z === b.z < z) continue;
            const den = b.z - a.z;
            if (Math.abs(den) < 1e-8) continue;
            const tEdge = (z - a.z) / den;
            hits.push({
                x: a.x + (b.x - a.x) * tEdge,
                y: a.y + (b.y - a.y) * tEdge,
                z,
            });
        }
        if (hits.length >= 2) segs.push({ a: hits[0]!, b: hits[1]! });
    }
    return segs;
}

function pointOnSideAtX(segs: Seg[], x: number, side: SideName, foot: Side): AfoVec3 | null {
    let best: AfoVec3 | null = null;
    let bestScore = -Infinity;
    for (const seg of segs) {
        const dx = seg.b.x - seg.a.x;
        if (Math.abs(dx) < 1e-4) {
            if (Math.abs(seg.a.x - x) > 1.4) continue;
            for (const p of [seg.a, seg.b]) consider(p);
            continue;
        }
        const t = (x - seg.a.x) / dx;
        if (t < -0.02 || t > 1.02) continue;
        const tc = clamp(t, 0, 1);
        consider({
            x,
            y: seg.a.y + (seg.b.y - seg.a.y) * tc,
            z: seg.a.z + (seg.b.z - seg.a.z) * tc,
        });
    }
    return best;

    function consider(p: AfoVec3) {
        const score = sideScore(p.y, side, foot);
        if (score > bestScore) {
            bestScore = score;
            best = p;
        }
    }
}

function pointOnSideAtStation(
    segs: Seg[],
    x: number,
    sTarget: number,
    sOf: (p: AfoVec3) => number,
    side: SideName,
    foot: Side,
): AfoVec3 | null {
    const exact = pointOnSideAtX(segs, x, side, foot);
    if (exact && sideScore(exact.y, side, foot) > 1) return exact;
    let best: AfoVec3 | null = null;
    let bestKey = Infinity;
    for (const seg of segs) {
        for (let k = 0; k <= 4; k += 1) {
            const p = lerp(seg.a, seg.b, k / 4);
            const score = sideScore(p.y, side, foot);
            if (score <= 0) continue;
            const key = Math.abs(sOf(p) - sTarget) * 200 - score;
            if (key < bestKey) {
                bestKey = key;
                best = p;
            }
        }
    }
    return best;
}

function walkTowardPosterior(
    slice: (z: number) => Seg[],
    origin: AfoVec3,
    distance: number,
    foot: Side,
): AfoVec3 {
    const segs = slice(origin.z);
    const center = sectionCenter(segs, origin, origin);
    const radius = Math.max(8, Math.hypot(origin.x - center.x, origin.y - center.y));
    const ang0 = Math.atan2(origin.y - center.y, origin.x - center.x);
    const posterior = Math.PI;
    let delta = posterior - ang0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = (distance / radius) * Math.sign(delta || 1);
    const hit = rayOutline(segs, center, ang0 + step);
    if (!hit) return origin;
    const side: SideName =
        sideScore(origin.y, "medial", foot) >= sideScore(origin.y, "lateral", foot) ? "medial" : "lateral";
    if (sideScore(hit.y, side, foot) < 0) return origin;
    return { ...hit, z: origin.z };
}

function sectionCenter(segs: Seg[], a: AfoVec3, b: AfoVec3): AfoVec3 {
    if (segs.length === 0) return mid(a, b);
    let x = 0;
    let y = 0;
    for (const seg of segs) {
        x += seg.a.x + seg.b.x;
        y += seg.a.y + seg.b.y;
    }
    const n = segs.length * 2;
    return { x: x / n, y: y / n, z: a.z };
}

function sweepAngle(lateral: AfoVec3, medial: AfoVec3, center: AfoVec3, u: number): number {
    const a = Math.atan2(lateral.y - center.y, lateral.x - center.x);
    const b = Math.atan2(medial.y - center.y, medial.x - center.x);
    const via = Math.PI;
    const up = (x: number) => {
        let y = x;
        while (y < a) y += Math.PI * 2;
        return y;
    };
    const bUp = up(b);
    const viaUp = up(via);
    if (viaUp <= bUp + 1e-3) return a + (bUp - a) * u;
    const down = (x: number) => {
        let y = x;
        while (y > a) y -= Math.PI * 2;
        return y;
    };
    return a + (down(b) - a) * u;
}

function rayOutline(segs: Seg[], origin: AfoVec3, angle: number): AfoVec3 | null {
    const dir = { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
    let best: AfoVec3 | null = null;
    let bestT = -Infinity;
    for (const seg of segs) {
        const hit = raySeg(origin, dir, seg.a, seg.b);
        if (hit && hit.t > bestT) {
            bestT = hit.t;
            best = hit.point;
        }
    }
    return best;
}

function raySeg(origin: AfoVec3, dir: AfoVec3, a: AfoVec3, b: AfoVec3): { t: number; point: AfoVec3 } | null {
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const den = dir.x * sy - dir.y * sx;
    if (Math.abs(den) < 1e-8) return null;
    const ox = a.x - origin.x;
    const oy = a.y - origin.y;
    const t = (ox * sy - oy * sx) / den;
    const u = (ox * dir.y - oy * dir.x) / den;
    if (t < 0.5 || u < -0.02 || u > 1.02) return null;
    return {
        t,
        point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: a.z },
    };
}

function filletPoints(before: AfoVec3, corner: AfoVec3, after: AfoVec3, radius: number): AfoVec3[] {
    const incoming = sub(corner, before);
    const outgoing = sub(after, corner);
    const il = len(incoming);
    const ol = len(outgoing);
    if (il < 1 || ol < 1) return [corner];
    const u = scale(incoming, 1 / il);
    const v = scale(outgoing, 1 / ol);
    const cos = clamp(dot(u, v), -1, 1);
    const theta = Math.acos(cos);
    if (theta < 0.25 || theta > 2.8) return [corner];
    const setback = Math.min(radius * Math.tan(theta / 2), il * 0.75, ol * 0.75);
    if (setback < 1) return [corner];
    const used = setback / Math.tan(theta / 2);
    const p0 = add(corner, scale(u, -setback));
    const p1 = add(corner, scale(v, setback));
    const bin = cross(u, v);
    const bl = len(bin);
    if (bl < 1e-6) return [corner];
    let n0 = norm(cross(scale(bin, 1 / bl), u));
    if (dot(n0, v) < 0) n0 = scale(n0, -1);
    const center = add(p0, scale(n0, used));
    const v0 = sub(p0, center);
    const v1 = sub(p1, center);
    const axis = norm(cross(v0, v1));
    if (len(axis) < 1e-6) return [p0, p1];
    const ang = Math.acos(clamp(dot(norm(v0), norm(v1)), -1, 1));
    if (ang < 0.05) return [corner];
    const steps = Math.max(3, Math.round((used * ang) / P.sampleMm));
    const pts: AfoVec3[] = [];
    for (let i = 1; i < steps; i += 1) {
        pts.push(add(center, rotateAround(v0, axis, ang * (i / steps))));
    }
    return pts;
}

function fairOnSurface(
    curve: AfoVec3[],
    projector: ReturnType<typeof meshProjector>,
    pinned: AfoVec3[],
    toeApex: AfoVec3,
): AfoVec3[] {
    const next = curve.map((p) => ({ ...p }));
    const n = curve.length;
    for (let i = 0; i < n; i += 1) {
        if (nearAny(curve[i]!, pinned, 0.8)) continue;
        if (dist(curve[i]!, toeApex) < P.toeRoundRadiusMm) continue;
        const prev = curve[(i - 1 + n) % n]!;
        const nxt = curve[(i + 1) % n]!;
        const blended = {
            x: curve[i]!.x * 0.5 + prev.x * 0.25 + nxt.x * 0.25,
            y: curve[i]!.y * 0.5 + prev.y * 0.25 + nxt.y * 0.25,
            z: curve[i]!.z * 0.5 + prev.z * 0.25 + nxt.z * 0.25,
        };
        const hit = projector.project(blended, curve[i]!, P.sampleMm);
        if (hit.errorMm <= P.maxSurfaceDeviationMm && dist(hit.point, curve[i]!) < 6) next[i] = hit.point;
    }
    return next;
}

function relaxRadius(curve: AfoVec3[], pinned: AfoVec3[], plantar: number, markers: ResolvedMarkers): void {
    const n = curve.length;
    for (let pass = 0; pass < 4; pass += 1) {
        for (let i = 0; i < n; i += 1) {
            if (nearAny(curve[i]!, pinned, 0.8)) continue;
            const prev = curve[(i - 1 + n) % n]!;
            const cur = curve[i]!;
            const next = curve[(i + 1) % n]!;
            const radius = circumradius(prev, cur, next);
            const minR = radiusFloor(cur, plantar, markers);
            if (radius >= minR) continue;
            const midP = lerp(prev, next, 0.5);
            curve[i] = lerp(cur, midP, 0.35);
        }
    }
}

function radiusFloor(p: AfoVec3, plantar: number, markers: ResolvedMarkers): number {
    const ankle = Math.min(dist(p, markers.mm), dist(p, markers.lm));
    if (ankle < 28 && p.z < markers.ajc.z + 8) return P.ankleConcaveRadiusMm;
    if (p.z < plantar + P.wallHeelMm + 18 && p.x < markers.ajc.x) return P.heelRadiusMm;
    if (p.z > markers.ajc.z + 40) return P.brimCornerRadiusMm;
    return P.convexRadiusMm;
}

function pushOffReliefs(curve: AfoVec3[], pinned: AfoVec3[], reliefs: AfoVec3[]): void {
    for (const relief of reliefs) {
        for (let i = 0; i < curve.length; i += 1) {
            if (nearAny(curve[i]!, pinned, 1.2)) continue;
            const gap = dist(curve[i]!, relief);
            if (gap >= P.reliefClearanceMm || gap < 0.2) continue;
            const dir = scale(sub(curve[i]!, relief), 1 / gap);
            const need = P.reliefClearanceMm - gap;
            curve[i] = add(curve[i]!, scale(dir, need));
        }
    }
}

function controlsAlong(
    curve: AfoVec3[],
    side: SideName,
    foot: Side,
    target: number,
    must: AfoVec3[],
): AfoVec3[] {
    const chain = curve.filter((p) => sideScore(p.y, side, foot) > 0);
    const source = chain.length >= 8 ? chain : curve;
    const count = clamp(Math.round(target), 20, 30);
    const out: AfoVec3[] = [];
    if (source.length <= count) out.push(...source.map((p) => ({ ...p })));
    else {
        const step = (source.length - 1) / (count - 1);
        for (let i = 0; i < count; i += 1) out.push({ ...source[Math.round(i * step)]! });
    }
    for (const point of must) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < out.length; i += 1) {
            const d = dist(out[i]!, point);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (out.length > 0) out[best] = { ...point };
    }
    return dedupe(out);
}

function restorePinned(curve: AfoVec3[], pinned: AfoVec3[]): void {
    for (const pin of pinned) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < curve.length; i += 1) {
            const d = dist(curve[i]!, pin);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (bestD < 8) curve[best] = { ...pin };
    }
}

function replaceNearest(chain: AfoVec3[], point: AfoVec3): void {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < chain.length; i += 1) {
        const d = Math.abs(chain[i]!.z - point.z) + Math.abs(chain[i]!.x - point.x) * 0.25;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    if (chain.length > 0) chain[best] = point;
}

function resampleOpen(points: AfoVec3[], spacing: number): AfoVec3[] {
    if (points.length < 2) return points.map((p) => ({ ...p }));
    const out: AfoVec3[] = [{ ...points[0]! }];
    let acc = 0;
    for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const span = dist(a, b);
        if (span < 1e-4) continue;
        let walked = spacing - acc;
        while (walked <= span) {
            out.push(lerp(a, b, walked / span));
            walked += spacing;
        }
        acc = span - (walked - spacing);
    }
    const last = points[points.length - 1]!;
    if (dist(out[out.length - 1]!, last) > spacing * 0.35) out.push({ ...last });
    return out;
}

function limitTurn(curve: AfoVec3[], pinned: AfoVec3[], toeApex: AfoVec3): void {
    const n = curve.length;
    const maxCos = Math.cos((P.maxTurnDeg * Math.PI) / 180);
    const held = (p: AfoVec3) => nearAny(p, pinned, 1) || dist(p, toeApex) < P.toeRoundRadiusMm * 0.35;
    for (let pass = 0; pass < 40; pass += 1) {
        let hot = false;
        for (let i = 0; i < n; i += 1) {
            const prevI = (i - 1 + n) % n;
            const nextI = (i + 1) % n;
            const prev = curve[prevI]!;
            const cur = curve[i]!;
            const next = curve[nextI]!;
            const v1 = sub(cur, prev);
            const v2 = sub(next, cur);
            const l1 = len(v1);
            const l2 = len(v2);
            if (l1 < 0.4 || l2 < 0.4) continue;
            if (dot(v1, v2) / (l1 * l2) >= maxCos) continue;
            hot = true;
            if (!held(cur)) {
                curve[i] = lerp(cur, lerp(prev, next, l1 / (l1 + l2)), 0.65);
                continue;
            }
            // A clinical sample stays put. Ease the two neighbors onto one tangent
            // so the sample itself is not a kink.
            const tangent = norm(add(scale(v1, 1 / l1), scale(v2, 1 / l2)));
            if (len(tangent) < 1e-4) continue;
            if (!held(prev)) curve[prevI] = lerp(prev, add(cur, scale(tangent, -l1)), 0.55);
            if (!held(next)) curve[nextI] = lerp(next, add(cur, scale(tangent, l2)), 0.55);
        }
        if (!hot) break;
    }
}

function maxTurn(points: AfoVec3[]): number {
    let max = 0;
    const n = points.length;
    for (let i = 0; i < n; i += 1) {
        const prev = points[(i - 1 + n) % n]!;
        const cur = points[i]!;
        const next = points[(i + 1) % n]!;
        const v1 = sub(cur, prev);
        const v2 = sub(next, cur);
        const l1 = len(v1);
        const l2 = len(v2);
        if (l1 < 0.4 || l2 < 0.4) continue;
        const cos = clamp(dot(v1, v2) / (l1 * l2), -1, 1);
        max = Math.max(max, (Math.acos(cos) * 180) / Math.PI);
    }
    return max;
}

function surfaceDeviation(
    projector: ReturnType<typeof meshProjector>,
    curve: AfoVec3[],
    toeApex: AfoVec3,
): number {
    let max = 0;
    for (const p of curve) {
        if (dist(p, toeApex) <= P.toeRoundRadiusMm + 2) continue;
        max = Math.max(max, projector.closest(p).errorMm);
    }
    return max;
}

function soleZ(mesh: AfoTriMesh, heel: AfoVec3): number {
    const n = vertexCount(mesh);
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
        const x = mesh.positions[i * 3] ?? 0;
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        if ((x - heel.x) ** 2 + (y - heel.y) ** 2 > 90 * 90) continue;
        if (z < best) best = z;
    }
    return Number.isFinite(best) ? best : heel.z;
}

function footForward(hc: AfoVec3, tt: AfoVec3): AfoVec3 {
    const raw = { x: tt.x - hc.x, y: tt.y - hc.y, z: 0 };
    const l = len(raw);
    if (l < 1e-3) return { x: 1, y: 0, z: 0 };
    return scale(raw, 1 / l);
}

function sideScore(y: number, side: SideName, foot: Side): number {
    const med = medialSign(foot);
    return side === "medial" ? y * med : -y * med;
}

function dedupe(points: AfoVec3[]): AfoVec3[] {
    const out: AfoVec3[] = [];
    for (const p of points) {
        const prev = out[out.length - 1];
        if (prev && dist(prev, p) < 0.35) continue;
        out.push({ ...p });
    }
    if (out.length > 2 && dist(out[0]!, out[out.length - 1]!) < 0.35) out.pop();
    return out;
}

function nearAny(p: AfoVec3, pins: AfoVec3[], mm: number): boolean {
    return pins.some((pin) => dist(p, pin) <= mm);
}

function circumradius(a: AfoVec3, b: AfoVec3, c: AfoVec3): number {
    const ab = dist(a, b);
    const bc = dist(b, c);
    const ca = dist(c, a);
    const area2 = len(cross(sub(b, a), sub(c, a)));
    if (area2 < 1e-6) return Infinity;
    // |a×b| is twice the triangle area, and R = abc / (4K).
    return (ab * bc * ca) / (2 * area2);
}

function rotateAround(v: AfoVec3, axis: AfoVec3, ang: number): AfoVec3 {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const k = cross(axis, v);
    const d = dot(axis, v);
    return {
        x: v.x * c + k.x * s + axis.x * d * (1 - c),
        y: v.y * c + k.y * s + axis.y * d * (1 - c),
        z: v.z * c + k.z * s + axis.z * d * (1 - c),
    };
}

function add(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(a: AfoVec3, s: number): AfoVec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function mid(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return scale(add(a, b), 0.5);
}
function lerp(a: AfoVec3, b: AfoVec3, t: number): AfoVec3 {
    return add(scale(a, 1 - t), scale(b, t));
}
function lerpNum(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function len(a: AfoVec3): number {
    return Math.hypot(a.x, a.y, a.z);
}
function norm(a: AfoVec3): AfoVec3 {
    const l = len(a);
    if (l < 1e-8) return { x: 0, y: 0, z: 0 };
    return scale(a, 1 / l);
}
function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
function smoother(t: number): number {
    const x = clamp(t, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Nearest vertex for a preset pin. Drag and shell generation already use this id. */
export function presetPinVertex(mesh: AfoTriMesh, point: AfoVec3): number {
    return nearestVertex(mesh, point).index;
}
