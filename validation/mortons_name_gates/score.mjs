// Pure gates. Frozen with thresholds.mjs before the candidate is measured.

import {
    ELEMENT_MEAN_Y_TOL_MM,
    ENGRAVE_DEPTH_MM,
    ENGRAVE_TRI_DELTA_MIN,
    FLOOR_AREA_MIN_MM2,
    FLOOR_AREA_RATIO_MIN,
    FORBIDDEN_PATH_RE,
    KIRI_FILES,
    MARKING_TEXT,
    MEDIAL_MEAN_Y_MAX_MM,
    MORTON_HEIGHT_MM,
    MORTON_HEIGHT_TOL_MM,
    MORTON_PLATEAU_MIN_MM,
    PLANTAR_AXIS_MAX_DEG,
    PLANTAR_SPAN_X_MIN_MM,
    PLANTAR_SPAN_Y_MAX_MM,
    PLANTAR_SPAN_Y_MIN_MM,
    SCOPE_ALLOW_PREFIXES,
    STOCK_FIXTURES,
    SURFACE_CELL_MM,
    SURFACE_MAX_DELTA_MM,
    SURFACE_Z_MIN_MM,
} from "./thresholds.mjs";

export function caseOf(meas, id) {
    const row = meas?.cases?.[id];
    if (!row) throw new Error(`measurement missing case ${id}`);
    return row;
}

function finite(n) {
    return typeof n === "number" && Number.isFinite(n);
}

/** Name is cut into the sole: floor area, extra triangles, and the export kept the text. */
export function namePresent(row, referenceArea) {
    const area = row?.floor?.areaMm2 ?? 0;
    const ratio = referenceArea > 0 ? area / referenceArea : 0;
    const triDelta = (row?.triCount ?? 0) - (row?.plainTriCount ?? row?.triCount ?? 0);
    const dropped = row?.textDropped === true;
    const pass =
        !dropped &&
        area + 1e-9 >= FLOOR_AREA_MIN_MM2 &&
        (referenceArea <= 0 || ratio + 1e-9 >= FLOOR_AREA_RATIO_MIN) &&
        triDelta + 1e-9 >= ENGRAVE_TRI_DELTA_MIN;
    return {
        pass,
        areaMm2: area,
        ratio,
        triDelta,
        textDropped: dropped,
    };
}

export function plantarReads(row) {
    const f = row?.floor ?? {};
    const spanX = f.spanX ?? 0;
    const spanY = f.spanY ?? 0;
    const axis = f.axisDeg ?? 999;
    const pass =
        spanX + 1e-9 >= PLANTAR_SPAN_X_MIN_MM &&
        spanY + 1e-9 >= PLANTAR_SPAN_Y_MIN_MM &&
        spanY <= PLANTAR_SPAN_Y_MAX_MM + 1e-9 &&
        Math.abs(axis) <= PLANTAR_AXIS_MAX_DEG + 1e-9;
    return { pass, spanX, spanY, axisDeg: axis };
}

export function gridDelta(candidateGrid, baseGrid) {
    const a = candidateGrid ?? {};
    const b = baseGrid ?? {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let maxDeltaMm = 0;
    let unmatched = 0;
    for (const key of keys) {
        if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) {
            unmatched++;
            continue;
        }
        maxDeltaMm = Math.max(maxDeltaMm, Math.abs(a[key] - b[key]));
    }
    return {
        pass: unmatched === 0 && maxDeltaMm <= SURFACE_MAX_DELTA_MM + 1e-9,
        maxDeltaMm,
        unmatched,
        cells: keys.size,
    };
}

/** Median raise of cells that sit on the pad. A 3 mm Morton's plateau is 3. */
export function plateauRaiseMm(mortonGrid, stockGrid) {
    const deltas = [];
    for (const key of Object.keys(mortonGrid ?? {})) {
        if (!Object.hasOwn(stockGrid ?? {}, key)) continue;
        const delta = mortonGrid[key] - stockGrid[key];
        if (delta > MORTON_PLATEAU_MIN_MM) deltas.push(delta);
    }
    if (!deltas.length) return null;
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor((deltas.length - 1) / 2)];
}

function hashesEqual(candidate, base, files) {
    const mismatches = [];
    for (const file of files) {
        const c = candidate?.fileSha256?.[file];
        const b = base?.fileSha256?.[file];
        if (!c || !b || c !== b) mismatches.push(file);
    }
    return { pass: mismatches.length === 0, mismatches };
}

function outOfScope(diffFiles) {
    const bad = [];
    for (const file of diffFiles ?? []) {
        if (SCOPE_ALLOW_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
        if (file.startsWith("vertex/src/")) bad.push(file);
    }
    return bad;
}

function forbiddenPaths(diffFiles) {
    return (diffFiles ?? []).filter((file) => FORBIDDEN_PATH_RE.test(file));
}

function newEngraver(diffFiles) {
    return (diffFiles ?? []).filter((file) => {
        if (file.startsWith("validation/mortons_name_gates/")) return false;
        if (file.startsWith("vertex/src/lib/geometry/text-marking/")) return false;
        return /engrave/i.test(file);
    });
}

function markingOk(meas) {
    const m = meas?.marking ?? {};
    return (
        m.surface === "bottom" &&
        m.mode === "engrave" &&
        m.feet === "both" &&
        m.text === MARKING_TEXT &&
        m.addPatientName === false &&
        finite(m.depthMm) &&
        Math.abs(m.depthMm - ENGRAVE_DEPTH_MM) < 1e-6
    );
}

/**
 * Grade one measurement against a BASE measurement.
 * `candidate` and `base` are the same object for the no-op proof.
 */
export function grade(candidate, base) {
    const mortonName = caseOf(candidate, "morton-left-name");
    const mortonPlain = caseOf(candidate, "morton-left-plain");
    const rightName = caseOf(candidate, "stock-right-name");
    const leftName = caseOf(candidate, "stock-left-name");
    const leftPlain = caseOf(candidate, "stock-left-plain");
    const baseMortonPlain = caseOf(base, "morton-left-plain");
    const baseMortonName = caseOf(base, "morton-left-name");
    const baseRight = caseOf(base, "stock-right-name");
    const baseLeftName = caseOf(base, "stock-left-name");
    const baseLeftPlain = caseOf(base, "stock-left-plain");

    const referenceArea = Math.max(rightName.floor?.areaMm2 ?? 0, leftName.floor?.areaMm2 ?? 0);
    const defect = namePresent({ ...mortonName, plainTriCount: mortonPlain.triCount }, referenceArea);
    const detectorRight = namePresent(
        { ...rightName, plainTriCount: leftPlain.triCount },
        rightName.floor?.areaMm2 ?? 0,
    );
    const detectorLeft = namePresent(
        { ...leftName, plainTriCount: leftPlain.triCount },
        leftName.floor?.areaMm2 ?? 0,
    );
    // The detector gate uses the foot's own area as the reference, so ratio is 1 when the floor exists.
    const detectorPass = detectorRight.pass && detectorLeft.pass;

    const plantarRight = plantarReads(rightName);
    const plantarLeft = plantarReads(leftName);
    const rightHashSame = rightName.stlSha256 && rightName.stlSha256 === baseRight.stlSha256;
    const leftNameHashSame = leftName.stlSha256 && leftName.stlSha256 === baseLeftName.stlSha256;
    const otherFoot = {
        pass: Boolean(rightHashSame && leftNameHashSame && plantarRight.pass && plantarLeft.pass),
        rightHashSame: Boolean(rightHashSame),
        leftNameHashSame: Boolean(leftNameHashSame),
        plantarRight,
        plantarLeft,
        rightTri: rightName.triCount,
        baseRightTri: baseRight.triCount,
        leftTri: leftName.triCount,
        baseLeftTri: baseLeftName.triCount,
    };

    const nameVsPlain = gridDelta(mortonName.highGrid, mortonPlain.highGrid);
    const nameVsBase = gridDelta(mortonName.highGrid, baseMortonPlain.highGrid);
    const plainVsBase = gridDelta(mortonPlain.highGrid, baseMortonPlain.highGrid);
    const raise = plateauRaiseMm(mortonPlain.highGrid, leftPlain.highGrid);
    const raiseOk = finite(raise) && Math.abs(raise - MORTON_HEIGHT_MM) <= MORTON_HEIGHT_TOL_MM + 1e-9;
    const meanY = mortonPlain.raisedMeanY;
    const medialOk = finite(meanY) && meanY < MEDIAL_MEAN_Y_MAX_MM;
    const meanYDelta =
        finite(meanY) && finite(baseMortonPlain.raisedMeanY)
            ? Math.abs(meanY - baseMortonPlain.raisedMeanY)
            : Infinity;
    const meanYStable = meanYDelta <= ELEMENT_MEAN_Y_TOL_MM + 1e-9;
    const heightMm = candidate?.element?.heightMm;
    const profileOk = heightMm === MORTON_HEIGHT_MM && candidate?.element?.kind === "mortons_extension";
    const element = {
        pass:
            nameVsPlain.pass &&
            nameVsBase.pass &&
            plainVsBase.pass &&
            raiseOk &&
            medialOk &&
            meanYStable &&
            profileOk,
        nameVsPlain,
        nameVsBase,
        plainVsBase,
        maxRaiseMm: raise,
        raisedMeanY: meanY,
        meanYDeltaMm: meanYDelta,
        heightMm,
    };

    const stockSurface = gridDelta(leftPlain.highGrid, baseLeftPlain.highGrid);
    const r1 = {
        pass: nameVsBase.pass && plainVsBase.pass && stockSurface.pass,
        mortonTopDeltaMm: nameVsBase.maxDeltaMm,
        mortonUnmatched: nameVsBase.unmatched,
        stockTopDeltaMm: stockSurface.maxDeltaMm,
        stockUnmatched: stockSurface.unmatched,
    };

    const kiri = hashesEqual(candidate, base, KIRI_FILES);
    const r2 = {
        pass: r1.pass && kiri.pass,
        kiriMismatches: kiri.mismatches,
        surfaceDeltaMm: Math.max(nameVsBase.maxDeltaMm, stockSurface.maxDeltaMm),
    };

    const scope = outOfScope(candidate.diffFiles);
    const forbidden = forbiddenPaths(candidate.diffFiles);
    const r3 = { pass: scope.length === 0 && forbidden.length === 0, scope, forbidden };

    const fixtures = hashesEqual(candidate, base, STOCK_FIXTURES);
    const newMesh = (candidate.diffFiles ?? []).filter((file) => /\.(glb|stl)$/i.test(file));
    const r4 = {
        pass:
            fixtures.pass &&
            newMesh.length === 0 &&
            candidate.stockFixture === "tests/fixtures/SAMPLE_Top.glb",
        fixtureMismatches: fixtures.mismatches,
        newMesh,
    };

    const engravers = newEngraver(candidate.diffFiles);
    const r5 = {
        pass: markingOk(candidate) && engravers.length === 0,
        marking: candidate.marking,
        engravers,
    };

    const deploy = (candidate.diffFiles ?? []).filter((file) =>
        /(vertex-web|vertex-api|railway)/i.test(file),
    );
    const r6 = {
        pass:
            (candidate.secretHits ?? 1) === 0 &&
            (candidate.phiHits ?? 1) === 0 &&
            deploy.length === 0 &&
            candidate.mergedToMain !== true,
        secretHits: candidate.secretHits,
        phiHits: candidate.phiHits,
        deploy,
    };

    const stockHashSame = leftPlain.stlSha256 && leftPlain.stlSha256 === baseLeftPlain.stlSha256;
    const r7 = {
        pass: Boolean(stockHashSame && leftNameHashSame && rightHashSame),
        stockHashSame: Boolean(stockHashSame),
        stockSha256: leftPlain.stlSha256,
        baseStockSha256: baseLeftPlain.stlSha256,
        leftNameHashSame: Boolean(leftNameHashSame),
        rightHashSame: Boolean(rightHashSame),
    };

    const one = {
        pass: defect.pass && otherFoot.pass && element.pass && r3.pass && r5.pass && r7.pass,
    };

    return {
        "G-DEFECT": defect,
        "G-DETECTOR": {
            pass: detectorPass,
            right: detectorRight,
            left: detectorLeft,
            referenceAreaMm2: referenceArea,
        },
        "G-OTHER-FOOT": otherFoot,
        "G-ELEMENT": element,
        "G-R1": r1,
        "G-R2": r2,
        "G-R3": r3,
        "G-R4": r4,
        "G-R5": r5,
        "G-R6": r6,
        "G-R7": r7,
        "G-ONE": one,
        meta: {
            baseMortonNameTri: baseMortonName.triCount,
            surfaceZMinMm: SURFACE_Z_MIN_MM,
            surfaceCellMm: SURFACE_CELL_MM,
        },
    };
}

/** Each mutation must make its gate fail. Returns the gates that still passed. */
export function badMutations(meas) {
    const breakers = [];

    const dropName = structuredClone(meas);
    dropName.cases["morton-left-name"].floor.areaMm2 = 0;
    dropName.cases["morton-left-name"].textDropped = true;
    dropName.cases["morton-left-name"].triCount = dropName.cases["morton-left-plain"].triCount;
    breakers.push(["G-DEFECT", dropName]);

    const blind = structuredClone(meas);
    blind.cases["stock-right-name"].floor.areaMm2 = 0;
    blind.cases["stock-right-name"].textDropped = true;
    blind.cases["stock-right-name"].triCount = blind.cases["stock-left-plain"].triCount;
    blind.cases["stock-left-name"].floor.areaMm2 = 0;
    blind.cases["stock-left-name"].textDropped = true;
    blind.cases["stock-left-name"].triCount = blind.cases["stock-left-plain"].triCount;
    breakers.push(["G-DETECTOR", blind]);

    const shiftName = structuredClone(meas);
    shiftName.cases["stock-right-name"].stlSha256 = "shifted";
    shiftName.cases["stock-right-name"].floor.axisDeg = 90;
    breakers.push(["G-OTHER-FOOT", shiftName]);

    const raisePad = structuredClone(meas);
    const moved = { ...raisePad.cases["morton-left-plain"].highGrid };
    const key = Object.keys(moved)[0];
    if (key) moved[key] = (moved[key] ?? 0) + 1;
    raisePad.cases["morton-left-plain"].highGrid = moved;
    raisePad.cases["morton-left-name"].highGrid = { ...moved };
    raisePad.cases["morton-left-plain"].maxRaiseMm = 6;
    raisePad.cases["morton-left-plain"].raisedMeanY = 12;
    breakers.push(["G-ELEMENT", raisePad]);

    const scarTop = structuredClone(meas);
    const top = { ...scarTop.cases["stock-left-plain"].highGrid };
    const topKey = Object.keys(top)[0];
    if (topKey) top[topKey] = (top[topKey] ?? 0) + 0.5;
    scarTop.cases["stock-left-plain"].highGrid = top;
    breakers.push(["G-R1", scarTop]);

    const moveSeam = structuredClone(meas);
    moveSeam.fileSha256 = { ...moveSeam.fileSha256, "vertex/src/lib/kiri/slicer.ts": "seam-moved" };
    breakers.push(["G-R2", moveSeam]);

    const wide = structuredClone(meas);
    wide.diffFiles = [...(wide.diffFiles ?? []), "vertex/src/lib/geometry/mortons-extension.ts"];
    breakers.push(["G-R3", wide]);

    const newMesh = structuredClone(meas);
    newMesh.fileSha256 = { ...newMesh.fileSha256, "tests/fixtures/SAMPLE_Top.glb": "replaced-mesh" };
    newMesh.diffFiles = [...(newMesh.diffFiles ?? []), "vertex/public/Templates/BrandNewSole.stl"];
    breakers.push(["G-R4", newMesh]);

    const emboss = structuredClone(meas);
    emboss.marking = { ...emboss.marking, mode: "emboss", surface: "wall" };
    emboss.diffFiles = [...(emboss.diffFiles ?? []), "vertex/src/lib/geometry/new-engrave-system.ts"];
    breakers.push(["G-R5", emboss]);

    const leak = structuredClone(meas);
    leak.secretHits = 2;
    leak.phiHits = 1;
    leak.diffFiles = [...(leak.diffFiles ?? []), "vertex-api/src/index.ts"];
    breakers.push(["G-R6", leak]);

    const retop = structuredClone(meas);
    retop.cases["stock-left-plain"].stlSha256 = "not-the-stock";
    breakers.push(["G-R7", retop]);

    const stillPass = [];
    for (const [id, broken] of breakers) {
        const report = grade(broken, meas);
        if (report[id]?.pass) stillPass.push(id);
    }
    return stillPass;
}

/** A measurement that has the Morton's-foot name, built only from BASE data. */
export function syntheticFixed(meas) {
    const fixed = structuredClone(meas);
    const donor = fixed.cases["stock-left-name"];
    const plain = fixed.cases["morton-left-plain"];
    fixed.cases["morton-left-name"] = {
        ...fixed.cases["morton-left-name"],
        floor: structuredClone(donor.floor),
        textDropped: false,
        triCount: plain.triCount + ENGRAVE_TRI_DELTA_MIN + 50,
        highGrid: structuredClone(plain.highGrid),
    };
    return fixed;
}
