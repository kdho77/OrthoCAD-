#!/usr/bin/env node
// Applies one deliberate product mutation in a throwaway worktree.
// The gates repo itself is not edited. Modes:
//   bad-t1-control  engrave even when there is no composed text
//   bad-t1-pretext  skip engraving on every cache hit
//   bad-t2-extra    drop text from the manufacturing fingerprint
//   bad-t3-export   Print -> Export drops the cache
//   bad-t4-shift    move one STL vertex by 0.25 mm
//   bad-surface     touch seam placement and add a fake api_key
//   good-t1         skip a second engrave when the cache already has a guide
//   good-t2         key the fingerprint on the composed patient name
//   good-t3         reuse a cached solid instead of reconstructing
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.argv[2];
const mode = process.argv[3];
if (!root || !mode) {
    console.error("usage: break-tree.mjs <worktree> <mode>");
    process.exit(2);
}

function edit(rel, from, to) {
    const path = resolve(root, rel);
    const text = readFileSync(path, "utf8");
    if (!text.includes(from)) {
        console.error(`pattern missing in ${rel} for ${mode}`);
        process.exit(1);
    }
    writeFileSync(path, text.replace(from, to));
}

const preview = "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts";
const cache = "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.ts";
const workflow = "vertex/src/stores/clinical-workflow-store.ts";
const stl = "vertex/src/lib/geometry/stl.ts";
const slicer = "vertex/src/lib/kiri/slicer.ts";
const engrave = "vertex/src/lib/geometry/text-marking/bottom-engrave.ts";
const hook = "vertex/src/hooks/useBaseInsoleGeometry.ts";

const earlyReturn = `    if (
        !hasActiveComposedTextMarking(
            options.textMarking,
            options.patientDisplayName,
            options.side ?? "right",
        )
    ) {
        return geometry;
    }
`;

if (mode === "bad-t1-control") {
    edit(preview, earlyReturn, "");
} else if (mode === "bad-t1-pretext") {
    edit(
        preview,
        "options: ProceduralPreviewOptions & { mirrored?: boolean },\n): Promise<BufferGeometry> {",
        "options: ProceduralPreviewOptions & { mirrored?: boolean },\n): Promise<BufferGeometry> {\n    return geometry;",
    );
} else if (mode === "bad-t2-extra") {
    edit(cache, "textMarking: textMarkingHash(options.textMarking),", 'textMarking: "",');
} else if (mode === "bad-t3-export") {
    edit(
        workflow,
        `function leaveProceduralLoftStep(prev: ClinicalStepId, next: ClinicalStepId): void {
    if (isProceduralLoftClinicalStep(prev) && !isProceduralLoftClinicalStep(next)) {
        invalidateProceduralPrintLoftForDesignStep();
    }
}`,
        `function leaveProceduralLoftStep(prev: ClinicalStepId, next: ClinicalStepId): void {
    if (prev === "print" && next === "export") {
        invalidateProceduralPrintLoftForDesignStep();
        return;
    }
    if (isProceduralLoftClinicalStep(prev) && !isProceduralLoftClinicalStep(next)) {
        invalidateProceduralPrintLoftForDesignStep();
    }
}`,
    );
} else if (mode === "bad-t4-shift") {
    edit(
        stl,
        `        readVertex(i0, a);
        readVertex(i1, b);
        readVertex(i2, c);`,
        `        readVertex(i0, a);
        readVertex(i1, b);
        readVertex(i2, c);
        if (t === 0) a.x += 0.25;`,
    );
} else if (mode === "bad-surface") {
    const path = resolve(root, slicer);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nconst api_key = "sk-gate-bad";\n`);
    const engravePath = resolve(root, engrave);
    writeFileSync(
        engravePath,
        `${readFileSync(engravePath, "utf8")}\n// gate-bad: seam moved onto the top surface\n`,
    );
} else if (mode === "good-t1") {
    edit(
        preview,
        "            const geometry = await applyExportText(cached, options);",
        `            const ud = cached.userData as {
                textGuide?: unknown;
                bottomOutlineWorld?: unknown;
                textFitError?: string;
            };
            const geometry =
                (ud?.textGuide || ud?.bottomOutlineWorld) && !ud?.textFitError
                    ? cached
                    : await applyExportText(cached, options);`,
    );
} else if (mode === "good-t2") {
    edit(
        cache,
        "textMarking: textMarkingHash(options.textMarking),",
        "textMarking: gateComposedKey(options, context),",
    );
    edit(
        cache,
        "export function manufacturingSolidIdentity(",
        `function gateComposedKey(
    options: ProceduralPreviewOptions,
    context: ManufacturingSolidContext,
): string {
    const marking = options.textMarking;
    if (!marking) return "";
    if (marking.surface !== "bottom") return textMarkingHash(marking);
    const side = options.side ?? context.side;
    let extra = marking.text ?? "";
    if (marking.differentOnLR) {
        extra = side === "left" ? marking.textLeft || marking.text : marking.textRight || marking.text;
    }
    const lines: string[] = [];
    const name = (options.patientDisplayName ?? "").trim().toUpperCase();
    if (marking.addPatientName !== false && name) lines.push(name);
    const extraLine = extra.trim().toUpperCase();
    if (extraLine) lines.push(extraLine);
    if (lines.length === 0) return marking.addPatientName !== false ? "" : "bottom:0";
    return textMarkingHash({ ...marking, text: lines.join("\\n") });
}

export function manufacturingSolidIdentity(`,
    );
} else if (mode === "good-t3") {
    edit(
        hook,
        `    manufacturingSolidFingerprint,
    publishPreviewManufacturingSolid,
    trackManufacturingLoftInflight,`,
        `    manufacturingSolidFingerprint,
    peekManufacturingSolid,
    publishPreviewManufacturingSolid,
    trackManufacturingLoftInflight,`,
    );
    edit(
        hook,
        "const preview = await reconstructProceduralPreviewInWorker(raw, solidOptions);",
        `const cachedSolid = peekManufacturingSolid(fingerprint, side);
                            const preview = cachedSolid
                                ? { geometry: cachedSolid, pattern: [] }
                                : await reconstructProceduralPreviewInWorker(raw, solidOptions);`,
    );
} else {
    console.error(`unknown mode ${mode}`);
    process.exit(2);
}

console.log(`applied ${mode} under ${root}`);
