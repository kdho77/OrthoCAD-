// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import type { PrinterPreset } from "@/lib/kiri";
import { useDesignStore } from "@/stores/design-store";
import { migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";
import { generateHybridGcode } from "./export-service";

const cap: {
    includeQuery: boolean;
    calls: number;
    impl: () => Promise<unknown>;
} = {
    includeQuery: true,
    calls: 0,
    impl: async () => ({ enabled: false }),
};

const sliceInputs: Array<{ expectedRegionCount?: number; regional3mfStorageKey?: string }> = [];
const uploads: string[] = [];

rs.mock("@/lib/geometry/export-geometry", () => ({
    buildExportStl: async () => singleFootStl().slice(0),
    buildOrderPairStl: async () => {
        throw new Error("pair STL is not the regional path");
    },
    buildOrderPairGeometry: async () => {
        throw new Error("pair geometry is not the regional path");
    },
    buildExportGlb: async () => new ArrayBuffer(0),
    exportModeFromMethod: () => "manufacturing",
    orderDownloadSides: () => ["left"],
}));

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        manufacturing: {
            get regional3mfEnabled() {
                if (!cap.includeQuery) return undefined;
                return {
                    query: async () => {
                        cap.calls += 1;
                        return cap.impl();
                    },
                };
            },
            prepareManufacturingStlUpload: {
                mutate: async ({ side }: { side: string }) => ({
                    uploadUrl: `https://upload.test/${side}/${uploads.length}`,
                    storageKey: `temp/${side}/${uploads.length}`,
                    token: "",
                }),
            },
            generateSolid: {
                mutate: async (input: { expectedRegionCount?: number; regional3mfStorageKey?: string }) => {
                    sliceInputs.push({
                        expectedRegionCount: input.expectedRegionCount,
                        regional3mfStorageKey: input.regional3mfStorageKey,
                    });
                    return { ok: true, gcode: "G1 X0\n", productionId: "p", balance: 3 };
                },
            },
        },
    },
}));

function writeBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ArrayBuffer {
    const v = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
    ];
    const faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    const buffer = new ArrayBuffer(84 + faces.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, faces.length, true);
    let offset = 84;
    for (const [a, b, c] of faces) {
        offset += 12;
        for (const i of [a, b, c]) {
            const p = v[i];
            if (!p) throw new Error("box vertex missing");
            view.setFloat32(offset, p[0] ?? 0, true);
            view.setFloat32(offset + 4, p[1] ?? 0, true);
            view.setFloat32(offset + 8, p[2] ?? 0, true);
            offset += 12;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }
    return buffer;
}

function concatStls(parts: ArrayBuffer[]): ArrayBuffer {
    const counts = parts.map((part) => new DataView(part).getUint32(80, true));
    const total = counts.reduce((sum, n) => sum + n, 0);
    const out = new ArrayBuffer(84 + total * 50);
    new DataView(out).setUint32(80, total, true);
    let cursor = 84;
    for (const part of parts) {
        new Uint8Array(out).set(new Uint8Array(part).subarray(84), cursor);
        cursor += part.byteLength - 84;
    }
    return out;
}

/** Thick heel, thin toe, so the leader block accepts the solid. */
function singleFootStl(): ArrayBuffer {
    return concatStls([writeBox(0, -30, 0, 10, 30, 24), writeBox(180, -15, 0, 200, 15, 4)]);
}

const belt: PrinterPreset = {
    id: "apex-belt-v2",
    name: "Apex Belt V2",
    method: "printing_solid",
    beltAngleDeg: 45,
};

let originalFetch: typeof fetch;

function withZone(): void {
    const design = useDesignStore.getState().design;
    const recipe = migratePrintRecipe(design.printRecipe);
    useDesignStore.setState({
        design: {
            ...design,
            method: "printing_solid",
            printRecipe: {
                ...recipe,
                defaultHardness: "Medium",
                zones: [
                    {
                        regionId: "met-left",
                        kind: "zone",
                        hardnessClass: "Soft",
                        priority: 2,
                        depth: { type: "mm", mm: 1 },
                        side: "left",
                        polygon: [
                            { x: 80, y: -16 },
                            { x: 150, y: -16 },
                            { x: 150, y: 4 },
                            { x: 80, y: 4 },
                        ],
                    },
                ],
            },
        },
    });
}

async function exportLeft() {
    return generateHybridGcode(
        "left",
        belt,
        { type: "rounded", radius_mm: 3 },
        {},
        {
            apexMaterialId: "ApexCore",
            includeLeaderBlock: true,
            deferDownload: true,
        },
    );
}

beforeEach(() => {
    cap.includeQuery = true;
    cap.calls = 0;
    cap.impl = async () => ({ enabled: false });
    sliceInputs.length = 0;
    uploads.length = 0;
    useDesignStore.setState({
        design: {
            ...useDesignStore.getState().design,
            method: "printing_solid",
            elements: [],
            splitElements: false,
        },
    });
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
            uploads.push(String(input));
            return new Response("", { status: 200 });
        }
        return new Response("missing", { status: 404 });
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("regional hardness capability check", () => {
    test("a design with no effective regions still sends the STL when the check would fail", async () => {
        cap.impl = async () => {
            throw new Error("HTTP 503");
        };
        const result = await exportLeft();
        expect(result.ok).toBe(true);
        expect(cap.calls).toBe(0);
        expect(sliceInputs).toHaveLength(1);
        expect(sliceInputs[0]?.expectedRegionCount).toBeUndefined();
        expect(sliceInputs[0]?.regional3mfStorageKey).toBeUndefined();
    });

    test("a missing capability procedure stops a regional export", async () => {
        withZone();
        cap.includeQuery = false;
        const result = await exportLeft();
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/Regional hardness could not be confirmed/);
        if (!result.ok) expect(result.reason).toMatch(/capability check is missing/);
        expect(sliceInputs).toHaveLength(0);
        expect(uploads).toHaveLength(0);
    });

    test("a network or non-2xx capability check stops a regional export", async () => {
        withZone();
        cap.impl = async () => {
            throw new Error("Failed to fetch");
        };
        const network = await exportLeft();
        expect(network.ok).toBe(false);
        if (!network.ok) expect(network.reason).toMatch(/could not be confirmed \(Failed to fetch\)/);
        expect(sliceInputs).toHaveLength(0);

        cap.impl = async () => {
            throw new Error("HTTP 503");
        };
        const status = await exportLeft();
        expect(status.ok).toBe(false);
        if (!status.ok) expect(status.reason).toMatch(/could not be confirmed \(HTTP 503\)/);
        expect(uploads).toHaveLength(0);
    });

    test("a malformed capability body stops a regional export", async () => {
        withZone();
        cap.impl = async () => ({});
        const missing = await exportLeft();
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.reason).toMatch(/malformed capability response \(missing enabled\)/);

        cap.impl = async () => "enabled";
        const text = await exportLeft();
        expect(text.ok).toBe(false);
        if (!text.ok) expect(text.reason).toMatch(/malformed capability response/);
        expect(sliceInputs).toHaveLength(0);
    });

    test("an explicit off stops a regional export", async () => {
        withZone();
        cap.impl = async () => ({ enabled: false });
        const result = await exportLeft();
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/Regional hardness is turned off on this server/);
        expect(sliceInputs).toHaveLength(0);
        expect(uploads).toHaveLength(0);
    });

    test("an explicit on sends the 3MF and the region count", async () => {
        withZone();
        cap.impl = async () => ({ enabled: true });
        const result = await exportLeft();
        expect(result.ok).toBe(true);
        expect(sliceInputs).toHaveLength(1);
        expect(sliceInputs[0]?.expectedRegionCount).toBeGreaterThan(0);
        expect(sliceInputs[0]?.regional3mfStorageKey).toMatch(/temp\/left\//);
        expect(uploads.length).toBeGreaterThan(1);
    });
});
