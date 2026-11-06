// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    createMemoryClientFileRepo,
    type DesignGeometryWrite,
    type MemoryDb,
} from "../../../shared/client-files.js";
import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import { asDesignDocument, designStateFromDocument } from "../../../src/features/clients/design-document.js";
import { createDesignWithStockPlaceholder } from "../../../src/stores/design-store.js";
import { settingsEnvelopeForSave, settingsForDesignSave } from "./design-schema.js";

const DESIGN_ID = "00000000-0000-4000-8000-0000000000d1";

function side(posting: number) {
    return {
        forefootPostingDeg: posting,
        rearfootPostingDeg: posting + 1,
        medialSkiveMm: 1,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 4,
        heelCupDepthMm: 12,
        heelCupHeightMm: 8,
        apexMoveMm: 1,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
        rearfootWedge: { side: "medial" as const, value: 3, unit: "mm" as const },
        forefootWedge: {
            side: "lateral" as const,
            value: 2,
            unit: "deg" as const,
            degreeMode: "station" as const,
        },
        fullLengthWedge: { side: "medial" as const, value: 3, unit: "mm" as const },
    };
}

function settingsFixture() {
    const left = side(2);
    const right = side(5);
    return {
        pattern: "full_contact" as const,
        method: "printing_solid" as const,
        thicknessMm: 3.5,
        usMenSize: 10,
        shoeWidth: "wide" as const,
        corrections: {
            unit: "mm" as const,
            linked: false,
            left,
            right,
        },
        elements: [],
        trimlines: {
            left: [{ x: 1, y: 2, z: 0 }],
            right: [{ x: 3, y: 4, z: 0.5 }],
        },
        printRecipe: {
            version: 1 as const,
            pattern: "gyroid" as const,
            profileId: "apex-belt-v2",
            defaultHardness: "Soft" as const,
            zones: [],
        },
        base: {
            assetId: "stock-sample",
            name: "Sample",
            source: "stock" as const,
            glbPath: "bases/sample.glb",
            url: "/bases/sample.glb",
            primarySide: "left",
        },
    };
}

function columnDocument(partial: Record<string, unknown>) {
    return {
        id: DESIGN_ID,
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 3,
        linked: true,
        unit: "mm",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        corrections: [
            {
                side: "left",
                forefootPostingDeg: 4,
                rearfootPostingDeg: 1,
                medialSkiveMm: 0,
                lateralSkiveMm: 0,
                archFillMm: 0,
                archHeightMm: 6,
                heelCupDepthMm: 0,
                heelCupHeightMm: 0,
                apexMoveMm: 0,
                medialFlangeMm: 0,
                lateralFlangeMm: 0,
            },
        ],
        elements: [],
        ...partial,
    };
}

describe("design settings round trip", () => {
    test("save then load returns the same wedge, trimline, print recipe, base, and posting", async () => {
        const settings = settingsFixture();
        expect(settingsForDesignSave(settings)).toEqual(settings);

        const db: MemoryDb = { clients: [], designs: [], exports: [], audits: [] };
        const repo = createMemoryClientFileRepo(db);
        const write: DesignGeometryWrite = {
            userId: "00000000-0000-4000-8000-0000000000aa",
            designId: DESIGN_ID,
            name: "Round trip",
            pattern: settings.pattern,
            method: settings.method,
            thicknessMm: settings.thicknessMm,
            unit: settings.corrections.unit,
            linked: settings.corrections.linked,
            corrections: { left: settings.corrections.left, right: settings.corrections.right },
            elements: settings.elements,
            settingsJson: settingsEnvelopeForSave(settings),
            ip: null,
        };
        await repo.saveDesignGeometry(write);

        const raw = await repo.loadDesignDocument(DESIGN_ID);
        const doc = asDesignDocument(raw);
        if (!doc) throw new Error("saved design document missing");
        const stored = readStoredDesignSettings(doc.settingsJson);
        expect(stored).toEqual(settings);
        expect(designStateFromDocument(doc)).toEqual(settings);

        const columns = (raw as { corrections: Array<Record<string, unknown>> }).corrections;
        expect(columns[0]?.forefootPostingDeg).toBe(2);
        expect(columns[0]?.rearfootWedge).toBeUndefined();
        expect(JSON.stringify(raw)).not.toContain("vertices");
    });

    test("the editor's default design settings survive save unchanged", () => {
        const design = createDesignWithStockPlaceholder();
        const plain = JSON.parse(JSON.stringify(design)) as Record<string, unknown>;
        expect(settingsForDesignSave(design)).toEqual(plain);
    });

    test("mesh blobs are dropped and the rest of the settings stay identical", () => {
        const settings = settingsFixture();
        const dirty = {
            ...settings,
            vertices: [0, 1, 2, 3],
            base: { ...settings.base, geometry: { faces: [0, 1, 2] } },
        };
        expect(settingsForDesignSave(dirty)).toEqual(settings);
        expect(settingsEnvelopeForSave(dirty)).toEqual({
            schemaVersion: 1,
            settings,
        });
    });

    test("old designs without settingsJson still load from columns", () => {
        const missing = asDesignDocument(columnDocument({}));
        const explicitNull = asDesignDocument(columnDocument({ settingsJson: null }));
        for (const doc of [missing, explicitNull]) {
            if (!doc) throw new Error("old design document missing");
            const loaded = designStateFromDocument(doc);
            expect(loaded.thicknessMm).toBe(3);
            expect(loaded.corrections.left.forefootPostingDeg).toBe(4);
            expect(loaded.corrections.left.rearfootPostingDeg).toBe(1);
            expect(loaded.corrections.left.archHeightMm).toBe(6);
            expect(loaded.corrections.left.rearfootWedge).toBeUndefined();
            expect(loaded.trimlines).toBeUndefined();
        }
    });

    test("an unrecognized settings version falls back to columns", () => {
        const doc = asDesignDocument(
            columnDocument({
                settingsJson: {
                    schemaVersion: 99,
                    settings: { ...settingsFixture(), thicknessMm: 9 },
                },
            }),
        );
        if (!doc) throw new Error("old design document missing");
        const loaded = designStateFromDocument(doc);
        expect(loaded.thicknessMm).toBe(3);
        expect(loaded.corrections.left.forefootPostingDeg).toBe(4);
    });

    test("amputation parameters round-trip in settingsJson and a design without them is unchanged", () => {
        const plain = settingsFixture();
        expect(settingsForDesignSave(plain)).toEqual(plain);
        const withFiller = {
            ...plain,
            amputation: {
                left: {
                    enabled: true,
                    points: [
                        { x: 180, y: 30 },
                        { x: 210, y: 0 },
                        { x: 180, y: -30 },
                    ],
                    height: 15,
                    filletInside: 10,
                    filletOutside: 30,
                    interfaceFillet: false,
                },
            },
        };
        expect(settingsForDesignSave(withFiller)).toEqual(withFiller);
        const stored = readStoredDesignSettings(settingsEnvelopeForSave(withFiller));
        expect(stored).toEqual(withFiller);
        expect(JSON.stringify(stored)).not.toMatch(/vertices|faces|stl/i);
    });

    test("a stored snapshot wins over older column values", () => {
        const settings = { ...settingsFixture(), thicknessMm: 7 };
        const doc = asDesignDocument(
            columnDocument({
                thicknessMm: 2,
                settingsJson: { schemaVersion: 1, settings },
            }),
        );
        if (!doc) throw new Error("stored design document missing");
        expect(designStateFromDocument(doc)).toEqual(settings);
    });
});
