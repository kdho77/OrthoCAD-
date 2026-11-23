/**
 * Frozen behavioral probe. Imports the subject tree's snapshot builder and
 * persist path. Writes measurements only. Thresholds live in run-gates.mjs.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.MANUFACTURING_BUCKET ??= "vertex-manufacturing";
process.env.STORAGE_BUCKET ??= "vertex-assets";

const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const STORED = {
    system: "US_M" as const,
    size: 9,
    left: null,
    right: null,
    width: "medium",
};

type FlangeRead = {
    Lmed: number | null;
    Llat: number | null;
    Rmed: number | null;
    Rlat: number | null;
    rightFlangePaths: boolean;
    parsedLateral: number | null | "absent";
};

function arg(name: string): string {
    const i = process.argv.indexOf(name);
    if (i < 0 || !process.argv[i + 1]) {
        throw new Error(`missing ${name}`);
    }
    return process.argv[i + 1]!;
}

function num(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stable(value: unknown): string {
    if (typeof value === "undefined") return '"__undefined__"';
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((entry) => stable(entry)).join(",")}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function readFlanges(
    design: {
        corrections: {
            left: { medialFlangeMm?: number; lateralFlangeMm?: number };
            right: { medialFlangeMm?: number; lateralFlangeMm?: number };
        };
    },
    paths: string[],
    parsedLateral: number | null | "absent",
): FlangeRead {
    return {
        Lmed: num(design.corrections.left.medialFlangeMm),
        Llat: num(design.corrections.left.lateralFlangeMm),
        Rmed: num(design.corrections.right.medialFlangeMm),
        Rlat: num(design.corrections.right.lateralFlangeMm),
        rightFlangePaths: paths.some(
            (entry) =>
                entry.includes("corrections.right.medialFlangeMm") ||
                entry.includes("corrections.right.lateralFlangeMm"),
        ),
        parsedLateral,
    };
}

async function main(): Promise<void> {
    const subject = path.resolve(arg("--subject"));
    const out = path.resolve(arg("--out"));
    const errors: string[] = [];

    const snapshotUrl = pathToFileURL(path.join(subject, "vertex/shared/saved-design-snapshot.ts")).href;
    const catalogUrl = pathToFileURL(path.join(subject, "vertex/shared/saved-design-catalog.ts")).href;
    const persistUrl = pathToFileURL(
        path.join(subject, "vertex/server/src/lib/saved-design-snapshot.ts"),
    ).href;
    const schemaUrl = pathToFileURL(path.join(subject, "vertex/server/src/lib/design-schema.ts")).href;
    const settingsUrl = pathToFileURL(path.join(subject, "vertex/shared/design-settings.ts")).href;
    const operatorUrl = pathToFileURL(path.join(subject, "vertex/server/src/auth/cad-operator.ts")).href;

    const snapshot = await import(snapshotUrl);
    const catalogMod = await import(catalogUrl);
    const persistMod = await import(persistUrl);
    const schemaMod = await import(schemaUrl);
    const settingsMod = await import(settingsUrl);
    const operator = await import(operatorUrl);

    const buildSavedDesignSnapshot = snapshot.buildSavedDesignSnapshot as (input: {
        stored: typeof STORED;
        catalog: unknown;
    }) => {
        design: {
            corrections: {
                left: { medialFlangeMm?: number; lateralFlangeMm?: number };
                right: { medialFlangeMm?: number; lateralFlangeMm?: number };
            };
            base?: { assetId?: string; glbPath?: string; url?: string; name?: string };
            paired?: { rightBase?: { mirrored?: boolean; assetId?: string; glbPath?: string } };
            textMarking?: {
                surface?: string;
                mode?: string;
                addPatientName?: boolean;
                bold?: boolean;
            };
        };
        paths: string[];
        ignoredFields: string[];
        usMenSize: number;
        shoeWidth: string;
        shoeWidthSource: string;
        hardness: string | null;
        hardnessSource: string;
        linkShoe: unknown;
    };
    const parseSavedDesignCatalog = catalogMod.parseSavedDesignCatalog as (input: unknown) => {
        flange?: { left?: { lateral_mm?: number }; right?: { lateral_mm?: number } };
    };
    const persistSavedDesignSnapshotOnDesign = persistMod.persistSavedDesignSnapshotOnDesign as (args: {
        prisma: unknown;
        principal: unknown;
        designId: string;
        catalog: unknown;
        buildSnapshot: typeof buildSavedDesignSnapshot;
    }) => Promise<{ settingsJson: unknown; paths: string[] }>;
    const settingsEnvelopeForSave = schemaMod.settingsEnvelopeForSave as (state: unknown) => unknown;
    const readStoredDesignSettings = settingsMod.readStoredDesignSettings as (raw: unknown) => {
        corrections?: FlangeRead extends never
            ? never
            : {
                  left: { medialFlangeMm?: number; lateralFlangeMm?: number };
                  right: { medialFlangeMm?: number; lateralFlangeMm?: number };
              };
    } | null;

    const principal = {
        kind: "cad_operator",
        credentialId: "cred-dogfood",
        tenantId: operator.DOGFOOD_TENANT_ID,
        scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
    };

    function parsedLateral(catalog: unknown): number | null | "absent" {
        const parsed = parseSavedDesignCatalog(catalog);
        const value = parsed.flange?.left?.lateral_mm;
        if (value === undefined) return "absent";
        return num(value);
    }

    function fresh(catalog: unknown): FlangeRead {
        const built = buildSavedDesignSnapshot({
            stored: STORED,
            catalog: parseSavedDesignCatalog(catalog),
        });
        return readFlanges(built.design, built.paths, parsedLateral(catalog));
    }

    function hashBuild(catalog: unknown): string {
        const built = buildSavedDesignSnapshot({
            stored: STORED,
            catalog: parseSavedDesignCatalog(catalog),
        });
        const payload = {
            design: built.design,
            paths: [...built.paths].sort(),
            ignoredFields: [...built.ignoredFields].sort(),
            usMenSize: built.usMenSize,
            shoeWidth: built.shoeWidth,
            shoeWidthSource: built.shoeWidthSource,
            hardness: built.hardness,
            hardnessSource: built.hardnessSource,
            linkShoe: built.linkShoe,
        };
        return sha256(stable(payload));
    }

    async function persistRead(catalog: unknown): Promise<FlangeRead> {
        const seeded = buildSavedDesignSnapshot({
            stored: STORED,
            catalog: parseSavedDesignCatalog({}),
        });
        seeded.design.corrections.left.medialFlangeMm = 3;
        seeded.design.corrections.left.lateralFlangeMm = 3;
        const settingsJson = settingsEnvelopeForSave(seeded.design);
        const current = {
            id: DESIGN_ID,
            ownerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            name: "Fixture insole",
            kind: "insole",
            pattern: "full_contact",
            method: "printing_solid",
            thicknessMm: 2,
            linked: true,
            unit: "mm",
            settingsJson,
            updatedAt: "2026-11-06T00:00:00.000Z",
            deletedAt: null,
            client: { tenantId: operator.DOGFOOD_TENANT_ID },
            integrationLink: {
                tenantId: operator.DOGFOOD_TENANT_ID,
                source: "vo2",
                externalOrderId: "fixture-order",
                sides: "pair",
                shoeSizeSystem: "US_M",
                shoeSize: 9,
                shoeSizeLeft: null,
                shoeSizeRight: null,
                shoeWidth: "medium",
            },
        };
        const prisma = {
            design: {
                findUnique: async () => current,
                update: async () => ({ id: DESIGN_ID }),
            },
        };
        const result = await persistSavedDesignSnapshotOnDesign({
            prisma,
            principal,
            designId: DESIGN_ID,
            catalog,
            buildSnapshot: buildSavedDesignSnapshot,
        });
        const settings = readStoredDesignSettings(result.settingsJson);
        const corrections = settings?.corrections;
        if (!corrections) throw new Error("persist read-back missing corrections");
        return readFlanges({ corrections }, result.paths, parsedLateral(catalog));
    }

    async function capture<T>(label: string, fn: () => T | Promise<T>): Promise<T | null> {
        try {
            return await fn();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${label}: ${message}`);
            return null;
        }
    }

    const explicitCatalog = { flange: { left: { medial_mm: 3, lateral_mm: 0 } } };
    const omittedCatalog = { flange: { left: { medial_mm: 3 } } };
    const slidersCatalog = {
        sliders_by_side: { left: { medial_flange_mm: 3, lateral_flange_mm: 0 } },
    };

    const r7Catalogs: Record<string, unknown> = {
        empty: {},
        archHigh: { arch: "high" },
        flexible: { flexible_foot: true },
        thickness: { thickness_mm: 3.5 },
        heelSlider: { sliders_by_side: { right: { heel_cup_depth_mm: 2 } } },
        slidersFlange: slidersCatalog,
        bilateral: {
            flange: {
                left: { medial_mm: 4, lateral_mm: 5 },
                right: { medial_mm: 6, lateral_mm: 1 },
            },
        },
        emptyFlange: { flange: { left: {} } },
        mildLevel: { flange: { right: { level: "mild" } } },
        levelPlusMedial: { flange: { left: { level: "high", medial_mm: 3 } } },
        metPad: { elements: [{ name: "Met Pad", side: "left" }] },
    };

    const emptyBuilt = await capture("empty", () =>
        buildSavedDesignSnapshot({ stored: STORED, catalog: parseSavedDesignCatalog({}) }),
    );

    const report = {
        explicitFresh: await capture("explicitFresh", () => fresh(explicitCatalog)),
        explicitPersist: await capture("explicitPersist", () => persistRead(explicitCatalog)),
        omittedFresh: await capture("omittedFresh", () => fresh(omittedCatalog)),
        omittedPersist: await capture("omittedPersist", () => persistRead(omittedCatalog)),
        slidersFresh: await capture("slidersFresh", () => fresh(slidersCatalog)),
        slidersPersist: await capture("slidersPersist", () => persistRead(slidersCatalog)),
        bilateral: {
            split: await capture("split", () =>
                fresh({
                    flange: {
                        left: { medial_mm: 4, lateral_mm: 5 },
                        right: { medial_mm: 6, lateral_mm: 1 },
                    },
                }),
            ),
            emptyLeft: await capture("emptyLeft", () => fresh({ flange: { left: {} } })),
            mildRight: await capture("mildRight", () => fresh({ flange: { right: { level: "mild" } } })),
            highLeft: await capture("highLeft", () => fresh({ flange: { left: { level: "high" } } })),
            levelPlusMedial: await capture("levelPlusMedial", () =>
                fresh({ flange: { left: { level: "high", medial_mm: 3 } } }),
            ),
        },
        sampleTop: emptyBuilt
            ? {
                  assetId: emptyBuilt.design.base?.assetId ?? null,
                  glbPath: emptyBuilt.design.base?.glbPath ?? null,
                  url: emptyBuilt.design.base?.url ?? null,
                  rightMirrored: emptyBuilt.design.paired?.rightBase?.mirrored === true,
                  rightAssetId: emptyBuilt.design.paired?.rightBase?.assetId ?? null,
                  rightGlbPath: emptyBuilt.design.paired?.rightBase?.glbPath ?? null,
              }
            : null,
        textMarking: emptyBuilt?.design.textMarking
            ? {
                  surface: emptyBuilt.design.textMarking.surface ?? null,
                  mode: emptyBuilt.design.textMarking.mode ?? null,
                  addPatientName: emptyBuilt.design.textMarking.addPatientName === true,
                  bold: emptyBuilt.design.textMarking.bold === true,
              }
            : null,
        r7: Object.fromEntries(
            Object.entries(r7Catalogs).map(([name, catalog]) => {
                try {
                    return [name, hashBuild(catalog)];
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    errors.push(`r7 ${name}: ${message}`);
                    return [name, null];
                }
            }),
        ),
        errors,
    };

    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
}

main().catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
