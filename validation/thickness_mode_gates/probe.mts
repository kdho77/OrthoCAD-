/**
 * Read-only measurement of one checkout. Prints one JSON object to stdout.
 * GATE_ROOT is the checkout. This file lives with the gates and is not copied
 * into the tree under test.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.GATE_ROOT;
if (!root) {
    console.error("GATE_ROOT is required");
    process.exit(2);
}

function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => stable(entry));
    if (value && typeof value === "object") {
        const source = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) {
            if (source[key] === undefined) continue;
            out[key] = stable(source[key]);
        }
        return out;
    }
    return value;
}

function hashDesign(design: unknown): string {
    return createHash("sha256").update(JSON.stringify(stable(design))).digest("hex");
}

type SidePair = { leftThicknessMm?: number; rightThicknessMm?: number };

function pick(design: Record<string, unknown>, roundTrip: Record<string, unknown> | null) {
    const paired = (design.paired ?? {}) as SidePair;
    const rtPaired = (roundTrip?.paired ?? {}) as SidePair;
    const text = (design.textMarking ?? {}) as Record<string, unknown>;
    const base = (design.base ?? {}) as Record<string, unknown>;
    const pairedBases = (design.paired ?? {}) as { rightBase?: { mirrored?: boolean } };
    return {
        thicknessMm: design.thicknessMm ?? null,
        shellThicknessMode: design.shellThicknessMode ?? null,
        leftThicknessMm: paired.leftThicknessMm ?? null,
        rightThicknessMm: paired.rightThicknessMm ?? null,
        shellThicknessRfMm: design.shellThicknessRfMm ?? null,
        shellThicknessMfMm: design.shellThicknessMfMm ?? null,
        shellThicknessFfMm: design.shellThicknessFfMm ?? null,
        shellThicknessBlendMm: design.shellThicknessBlendMm ?? null,
        method: design.method ?? null,
        assetId: base.assetId ?? null,
        source: base.source ?? null,
        glbPath: base.glbPath ?? null,
        url: base.url ?? null,
        rightMirrored: pairedBases.rightBase?.mirrored === true,
        elementCount: Array.isArray(design.elements) ? design.elements.length : null,
        textSurface: text.surface ?? null,
        textMode: text.mode ?? null,
        addPatientName: text.addPatientName === true,
        textHash: hashDesign(text),
        hash: hashDesign(design),
        roundTrip: roundTrip
            ? {
                  thicknessMm: roundTrip.thicknessMm ?? null,
                  shellThicknessMode: roundTrip.shellThicknessMode ?? null,
                  leftThicknessMm: rtPaired.leftThicknessMm ?? null,
                  rightThicknessMm: rtPaired.rightThicknessMm ?? null,
              }
            : null,
    };
}

const stored = { system: "US_M" as const, size: 9, left: null, right: null, width: null };

try {
    const snap = await import(pathToFileURL(join(root, "vertex/shared/saved-design-snapshot.ts")).href);
    const cat = await import(pathToFileURL(join(root, "vertex/shared/saved-design-catalog.ts")).href);
    const schema = await import(pathToFileURL(join(root, "vertex/server/src/lib/design-schema.ts")).href);
    const settingsMod = await import(pathToFileURL(join(root, "vertex/shared/design-settings.ts")).href);

    function build(catalog: unknown) {
        const design = snap.buildSavedDesignSnapshot({
            stored,
            catalog: cat.parseSavedDesignCatalog(catalog),
        }).design as Record<string, unknown>;
        const envelope = schema.settingsEnvelopeForSave(design);
        const roundTrip = settingsMod.readStoredDesignSettings(envelope) as Record<string, unknown> | null;
        return pick(design, roundTrip);
    }

    const guardPath = join(root, "vertex/src/features/exports/saved-design-finalized-mesh.ts");
    const guardSource = readFileSync(guardPath, "utf8");
    const handlerPath = join(root, "packages/mcp/src/tools/handlers.ts");
    const handlerSource = readFileSync(handlerPath, "utf8");
    const loftTestPath = join(root, "vertex/src/features/exports/saved-design-thickness-loft.test.ts");
    const loftTest = readFileSync(loftTestPath, "utf8");

    const report = {
        ok: true,
        omitted: build({}),
        thick3: build({ thickness_mm: 3 }),
        archHigh: build({
            arch: "high",
            flexible_foot: true,
            sliders: { heel_lift_mm: 2 },
        }),
        guardNameCount: (guardSource.match(/assertSolidManufacturingShellThickness/g) ?? []).length,
        readPathGuardCount: (handlerSource.match(/assertSolidManufacturingShellThickness/g) ?? []).length,
        loftForefootBand:
            loftTest.includes("maxTopZInLengthBand") &&
            loftTest.includes("toBeGreaterThanOrEqual(0.9)") &&
            loftTest.includes("toBeLessThanOrEqual(1.1)"),
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exit(1);
}
