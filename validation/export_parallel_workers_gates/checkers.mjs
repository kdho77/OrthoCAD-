// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.

import {
    EULER_CHARACTERISTIC,
    MAX_FALLBACK_WORKER_CONSTRUCTS,
    MAX_WARM_EXTRA_POSTS,
    MIN_PEAK_BUSY_WORKERS,
    MIN_WORKER_INSTANCES,
    MIN_WORKER_POSTS_PER_COLD_FOOT,
    VERTEX_DELTA_MM,
} from "./thresholds.mjs";

export function row(id, pass, measured, threshold, detail) {
    return { id, pass: Boolean(pass), measured, threshold, detail };
}

function solidPosts(trace) {
    return (trace.events ?? []).filter((event) => event.kind === "solid-post");
}

export function checkParallelDispatch(trace) {
    const posts = solidPosts(trace);
    const workerIds = new Set(posts.map((event) => event.workerId));
    const sides = new Set(posts.map((event) => event.side));
    const measured = {
        workerInstances: workerIds.size,
        peakBusyWorkers: trace.peakBusyWorkers ?? 0,
        sides: [...sides].sort(),
        solidPosts: posts.length,
        eventLoopTurnedWhileBothBusy: Boolean(trace.eventLoopTurnedWhileBothBusy),
        constructs: (trace.events ?? []).filter((event) => event.kind === "construct").length,
    };
    const threshold = {
        workerInstances: MIN_WORKER_INSTANCES,
        peakBusyWorkers: MIN_PEAK_BUSY_WORKERS,
        sides: ["left", "right"],
        eventLoopTurnedWhileBothBusy: true,
    };
    const pass =
        measured.workerInstances >= MIN_WORKER_INSTANCES &&
        measured.peakBusyWorkers >= MIN_PEAK_BUSY_WORKERS &&
        sides.has("left") &&
        sides.has("right") &&
        measured.eventLoopTurnedWhileBothBusy === true;
    return row("T1", pass, measured, threshold, "2-foot cold export dispatches Left and Right together");
}

export function checkPreviewCancel(trace) {
    const preview = trace.preview ?? {};
    const measured = {
        constructed: preview.constructed ?? 0,
        terminated: Boolean(preview.terminated),
        rejectedCancelled: Boolean(preview.rejectedCancelled),
    };
    const threshold = { constructed: 1, terminated: true };
    const pass = measured.constructed >= 1 && measured.terminated;
    return row("T4a", pass, measured, threshold, "preview unmount terminates the in-flight worker");
}

export function checkExportCancel(trace) {
    const parts = ["exportAbort", "exportUnmount"];
    const measured = {};
    let pass = true;
    for (const part of parts) {
        const rowPart = trace[part] ?? {};
        const ok =
            (rowPart.constructed ?? 0) >= 1 &&
            rowPart.terminated === true &&
            rowPart.rejectedCancelled === true;
        measured[part] = {
            constructed: rowPart.constructed ?? 0,
            terminated: Boolean(rowPart.terminated),
            rejectedCancelled: Boolean(rowPart.rejectedCancelled),
            ok,
        };
        if (!ok) pass = false;
    }
    const threshold = { constructed: 1, terminated: true, rejectedCancelled: true };
    return row(
        "T4b",
        pass,
        measured,
        threshold,
        "export abort and unmount terminate in-flight solid workers",
    );
}

export function checkManifold(man, product) {
    const measured = {
        triangles: man?.triangleCount ?? 0,
        openEdges: man?.openEdges ?? null,
        nonManifoldEdges: man?.nonManifoldEdges ?? null,
        euler: man?.eulerCharacteristic ?? null,
        watertight: Boolean(man?.isWatertight),
        productEuler: product?.euler ?? null,
        productWatertight: product?.isWatertight ?? null,
        productOpenEdges: product?.openEdges ?? null,
        productTriangles: product?.triangles ?? null,
    };
    const threshold = {
        euler: EULER_CHARACTERISTIC,
        watertight: true,
        openEdges: 0,
        trianglesMin: 1,
    };
    const independentOk =
        measured.watertight === true &&
        measured.euler === EULER_CHARACTERISTIC &&
        measured.openEdges === 0 &&
        measured.triangles >= 1;
    const productOk =
        !product ||
        (product.isWatertight === true &&
            product.euler === EULER_CHARACTERISTIC &&
            product.openEdges === 0 &&
            product.triangles === measured.triangles);
    const agree =
        !product || (product.isWatertight === measured.watertight && product.euler === measured.euler);
    return {
        pass: independentOk && productOk && agree,
        measured,
        threshold,
    };
}

export function checkGeometryMatch(cmp, productA, productB) {
    const manA = checkManifold(cmp.manA, productA);
    const manB = checkManifold(cmp.manB, productB);
    const measured = {
        maxDeltaMm: cmp.maxDeltaMm,
        topBandDeltaMm: cmp.topBandDeltaMm,
        soleBandDeltaMm: cmp.soleBandDeltaMm,
        trianglesA: cmp.trianglesA,
        trianglesB: cmp.trianglesB,
        bytesEqual: cmp.bytesEqual,
        shaA: cmp.shaA,
        shaB: cmp.shaB,
        topBandVerts: cmp.topBandVerts ?? 0,
        soleBandVerts: cmp.soleBandVerts ?? 0,
        manifoldA: manA.measured,
        manifoldB: manB.measured,
    };
    const threshold = {
        maxDeltaMm: VERTEX_DELTA_MM,
        topBandDeltaMm: VERTEX_DELTA_MM,
        soleBandDeltaMm: VERTEX_DELTA_MM,
        trianglesEqual: true,
        euler: EULER_CHARACTERISTIC,
        watertight: true,
    };
    const pass =
        cmp.trianglesEqual === true &&
        cmp.maxDeltaMm <= VERTEX_DELTA_MM &&
        cmp.topBandDeltaMm <= VERTEX_DELTA_MM &&
        cmp.soleBandDeltaMm <= VERTEX_DELTA_MM &&
        manA.pass &&
        manB.pass;
    return { pass, measured, threshold };
}

export function checkCaseOk(entry) {
    if (!entry || entry.ok !== true) {
        return row(
            "case",
            false,
            { error: entry?.error ?? "missing" },
            { ok: true },
            "export produced an STL",
        );
    }
    const man = {
        triangleCount: entry.product?.triangles,
        openEdges: entry.product?.openEdges,
        nonManifoldEdges: entry.product?.nonManifoldEdges,
        eulerCharacteristic: entry.product?.euler,
        isWatertight: entry.product?.isWatertight,
    };
    const checked = checkManifold(man, null);
    return row(
        "case",
        checked.pass && entry.byteLength > 84,
        { ...checked.measured, byteLength: entry.byteLength, sha256: entry.sha256 },
        { ...checked.threshold, byteLengthMin: 85 },
        "STL manifold",
    );
}

export function checkFallback(entry) {
    const measured = {
        workerConstructs: entry?.workerConstructs ?? null,
        workerPosts: entry?.workerPosts ?? null,
        ok: entry?.ok === true,
        byteLength: entry?.byteLength ?? 0,
        error: entry?.error ?? null,
    };
    const threshold = {
        workerConstructs: MAX_FALLBACK_WORKER_CONSTRUCTS,
        workerPosts: MAX_FALLBACK_WORKER_CONSTRUCTS,
        ok: true,
    };
    const pass =
        measured.ok &&
        measured.workerConstructs === MAX_FALLBACK_WORKER_CONSTRUCTS &&
        measured.workerPosts === MAX_FALLBACK_WORKER_CONSTRUCTS &&
        measured.byteLength > 84;
    return row("T3", pass, measured, threshold, "Worker undefined stays on the main thread");
}

export function checkWarm(cold, warm) {
    const measured = {
        hashesEqual: Boolean(cold?.sha256 && cold.sha256 === warm?.sha256),
        warmPosts: warm?.workerPosts ?? null,
        warmConstructs: warm?.workerConstructs ?? null,
        coldOk: cold?.ok === true,
        warmOk: warm?.ok === true,
    };
    const threshold = {
        hashesEqual: true,
        warmPosts: MAX_WARM_EXTRA_POSTS,
        warmConstructs: MAX_FALLBACK_WORKER_CONSTRUCTS,
    };
    const pass =
        measured.coldOk &&
        measured.warmOk &&
        measured.hashesEqual &&
        measured.warmPosts <= MAX_WARM_EXTRA_POSTS &&
        measured.warmConstructs <= MAX_FALLBACK_WORKER_CONSTRUCTS;
    return row(
        "T3-warm",
        pass,
        measured,
        threshold,
        "warm cache hit matches the cold STL and does not loft again",
    );
}

export function checkWorkerCase(entry) {
    const measured = {
        ok: entry?.ok === true,
        workerPosts: entry?.workerPosts ?? 0,
        workerConstructs: entry?.workerConstructs ?? 0,
        workerErrors: entry?.workerErrors ?? [],
        fallbackWarnings: entry?.fallbackWarnings ?? [],
    };
    const threshold = {
        workerPosts: MIN_WORKER_POSTS_PER_COLD_FOOT,
        workerErrors: 0,
        fallbackWarnings: 0,
    };
    const pass =
        measured.ok &&
        measured.workerPosts >= MIN_WORKER_POSTS_PER_COLD_FOOT &&
        measured.workerErrors.length === 0 &&
        measured.fallbackWarnings.length === 0;
    return row(
        "T2-worker-used",
        pass,
        measured,
        threshold,
        "cold solid was produced by a worker, not a main-thread fallback",
    );
}

export function checkEngraveMarking(entry) {
    const measured = {
        surface: entry?.textSurface ?? null,
        mode: entry?.textMode ?? null,
    };
    const threshold = { surface: "bottom", mode: "engrave" };
    const pass = measured.surface === "bottom" && measured.mode === "engrave";
    return row("R4-marking", pass, measured, threshold, "textMarking stays bottom engrave");
}

export function checkHashesDiffer(a, b) {
    const measured = { shaA: a?.sha256 ?? null, shaB: b?.sha256 ?? null, differ: a?.sha256 !== b?.sha256 };
    const threshold = { differ: true };
    const pass = Boolean(a?.sha256 && b?.sha256 && a.sha256 !== b.sha256);
    return row(
        "engraved-differs",
        pass,
        measured,
        threshold,
        "patient-name engrave changes the STL versus stock",
    );
}

export function checkTests(exitCode) {
    const measured = { exitCode };
    const threshold = { exitCode: 0 };
    return row("T5", exitCode === 0, measured, threshold, "existing export tests exit 0");
}

export function checkSourceRules(source) {
    return {
        R1: row(
            "R1-source",
            source.sourcePass.R1,
            source.dirty.surface,
            { dirty: [] },
            "surface files unchanged",
        ),
        R2: row(
            "R2-source",
            source.sourcePass.R2,
            source.dirty.seam,
            { dirty: [] },
            "seam and slicer files unchanged",
        ),
        R3: row(
            "R3",
            source.sourcePass.R3,
            { outsideAllowlist: source.outsideAllowlist, changedFiles: source.changedFiles },
            { outsideAllowlist: [] },
            "diff stays on the cold-export worker surface",
        ),
        R4: row(
            "R4-source",
            source.sourcePass.R4,
            source.dirty.text,
            { dirty: [] },
            "no new engraving system",
        ),
        R5: row(
            "R5",
            source.sourcePass.R5,
            { secretHits: source.secretHits, railway: source.dirty.railway, database: source.dirty.database },
            { secretHits: [], railway: [], database: [] },
            "no secrets, Railway, or database writes in the diff",
        ),
        R6: row(
            "R6-source",
            source.sourcePass.R6,
            {
                fingerprint: source.dirty.fingerprint,
                sampleTopBodyIdentical: source.sampleTopBodyIdentical,
                surface: source.dirty.surface,
                text: source.dirty.text,
            },
            { fingerprint: [], sampleTopBodyIdentical: true, surface: [], text: [] },
            "fingerprint, cache, walls, and engraving source unchanged",
        ),
    };
}
