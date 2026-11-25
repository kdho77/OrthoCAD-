// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import { Cache } from "three";
import { designStateFromDocument } from "@/features/clients/design-document";
import { buildMillCncGcode, PRINT_ORDER_CNC_REFUSAL } from "@/lib/cnc/mill-job";
import { cncSidesForOrder, internalSideForPhysicalFoot, millExportSides } from "@/lib/cnc/order-sides";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { orderDownloadSides } from "@/lib/geometry/export-geometry";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import type { DesignState } from "@/types";
import { designSettingsEnvelope } from "../../../shared/design-settings";
import { cncPairGcodeFilename } from "../../../shared/export-filename.js";
import { CNC_GCODE_PRESET_ID } from "../auth/cad-operator.js";
import { cadOperatorManufacturingIdentity } from "./cad-operator-production.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERTEX_CWD = resolve(HERE, "../../..");
const SAMPLE_TOP = resolve(VERTEX_CWD, "public/Templates/SAMPLE_Top.glb");
const PARITY_CHECK = resolve(VERTEX_CWD, "scripts/cnc-mill-parity-check.ts");

interface ServerMillResult {
    ok: boolean;
    message?: string;
    sides?: Array<"left" | "right">;
    method?: string;
    fileExtension?: string;
    gcode?: string;
}

let bundleReady: Promise<void> | null = null;

function ensureCncBundle(): Promise<void> {
    bundleReady ??= new Promise((resolveBundle, rejectBundle) => {
        try {
            execFileSync(process.execPath, ["scripts/bundle-cnc-mill-job.mjs"], {
                cwd: VERTEX_CWD,
                stdio: "inherit",
            });
            resolveBundle();
        } catch (error) {
            rejectBundle(error);
        }
    });
    return bundleReady;
}

/** Node load of the mill bundle. Rstest's bundler breaks that file's exports. */
function serverMill(
    mode: "prepare" | "gcode",
    doc: unknown,
    millSide?: "LR" | "RR" | "LL",
): ServerMillResult {
    const dir = mkdtempSync(join(tmpdir(), "cnc-mill-"));
    const inPath = join(dir, "in.json");
    const outPath = join(dir, "out.json");
    writeFileSync(inPath, JSON.stringify(doc));
    const args = ["--experimental-strip-types", PARITY_CHECK, mode, inPath, outPath];
    if (millSide) args.push(millSide);
    execFileSync(process.execPath, args, {
        cwd: VERTEX_CWD,
        stdio: "inherit",
    });
    return JSON.parse(readFileSync(outPath, "utf8")) as ServerMillResult;
}

const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function cncIdempotencyKey(designId: string, sides: Array<"left" | "right">, fingerprint: string): string {
    const sideKey = sides.length === 1 ? sides[0] : "pair";
    return `cadop:v1:${designId}:${sideKey}:${CNC_GCODE_PRESET_ID}:${fingerprint}`;
}

function installSampleTopFetch(bytes: Uint8Array): void {
    const marker = globalThis as { __ocadSampleTopRequest?: boolean };
    if (!marker.__ocadSampleTopRequest) {
        marker.__ocadSampleTopRequest = true;
        const OriginalRequest = globalThis.Request;
        const PatchedRequest = function PatchedRequest(input: string | URL, init?: RequestInit) {
            if (typeof input === "string" && input.startsWith("/")) {
                return new OriginalRequest(`http://127.0.0.1${input}`, init);
            }
            return new OriginalRequest(input, init);
        } as unknown as typeof Request;
        PatchedRequest.prototype = OriginalRequest.prototype;
        globalThis.Request = PatchedRequest;
    }
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (/SAMPLE_Top\.glb(?:$|[?#])/i.test(url)) {
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            return new Response(copy, { status: 200, headers: { "content-type": "model/gltf-binary" } });
        }
        return original(input, init);
    }) as typeof globalThis.fetch;
}

function pairedMillDesign(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "milling_3axis";
    design.usMenSize = 9;
    design.thicknessMm = 3;
    if (design.paired) {
        design.paired.leftMethod = "milling_3axis";
        design.paired.rightMethod = "milling_3axis";
        design.paired.leftThicknessMm = 3;
        design.paired.rightThicknessMm = 3;
    }
    return design;
}

function savedDocument(design: DesignState) {
    const settingsJson = JSON.parse(JSON.stringify(designSettingsEnvelope(design))) as unknown;
    return {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        pattern: design.pattern,
        method: design.method,
        thicknessMm: design.thicknessMm,
        linked: design.corrections.linked,
        unit: design.corrections.unit,
        createdAt: "2026-11-15T00:00:00.000Z",
        updatedAt: "2026-11-15T00:00:00.000Z",
        settingsJson,
    };
}

describe("server pair CNC G-code", () => {
    test("bundle loads and a print design is refused", async () => {
        await ensureCncBundle();
        const design = createDesignWithStockPlaceholder();
        const refused = serverMill("prepare", savedDocument(design));
        expect(refused.ok).toBe(false);
        expect(refused.message).toContain(PRINT_ORDER_CNC_REFUSAL);
    }, 120_000);

    test("a single-side milled order uses cncSidesForOrder", async () => {
        await ensureCncBundle();
        const design = pairedMillDesign();
        if (design.paired) design.paired.rightBase = undefined;
        const prepared = serverMill("prepare", savedDocument(design));
        expect(cncSidesForOrder(design, ["right"])).toEqual(["left"]);
        expect(prepared.ok).toBe(true);
        expect(prepared.sides).toEqual(["left"]);
    });

    test("pair file matches the browser Mill export byte for byte", async () => {
        await ensureCncBundle();
        expect(IDAHO_PROFILE.id).toBe("vertex-lab-idaho-one-side");
        expect(IDAHO_PROFILE.fileExtension).toBe(".gcode");
        useMillingProfileStore.setState({ profile: cloneProfile(IDAHO_PROFILE), placements: [] });
        const design = pairedMillDesign();
        const hydrated = designStateFromDocument(savedDocument(design));
        expect(hydrated.method).toBe("milling_3axis");
        expect(hydrated.thicknessMm).toBe(3);
        expect(hydrated.paired?.leftThicknessMm).toBe(3);
        expect(hydrated.paired?.rightThicknessMm).toBe(3);
        installSampleTopFetch(new Uint8Array(readFileSync(SAMPLE_TOP)));
        Cache.clear();
        const browser = await buildMillCncGcode({
            design: hydrated,
            profile: cloneProfile(IDAHO_PROFILE),
            placements: useMillingProfileStore.getState().placements,
            requestedSides: orderDownloadSides(hydrated),
        });
        const server = serverMill("gcode", savedDocument(design));
        expect(server.ok).toBe(true);
        const browserBytes = Buffer.from(browser.gcode, "utf8");
        const serverBytes = Buffer.from(server.gcode ?? "", "utf8");
        expect(server.sides).toEqual(["left", "right"]);
        expect(browser.sides).toEqual(["left", "right"]);
        expect(server.fileExtension).toBe(".gcode");
        expect(server.gcode).toContain("; foot: left+right");
        expect(serverBytes.equals(browserBytes)).toBe(true);
    }, 300_000);
});

describe("generateCncGcode millSide on the server path", () => {
    test("RR and LL sides, filenames, idempotency keys, and G-code match the browser export", async () => {
        await ensureCncBundle();
        useMillingProfileStore.setState({ profile: cloneProfile(IDAHO_PROFILE), placements: [] });
        const design = pairedMillDesign();
        const doc = savedDocument(design);
        const hydrated = designStateFromDocument(doc);
        installSampleTopFetch(new Uint8Array(readFileSync(SAMPLE_TOP)));
        Cache.clear();

        const internalRight = internalSideForPhysicalFoot(hydrated, "right");
        const internalLeft = internalSideForPhysicalFoot(hydrated, "left");
        const rrSides = millExportSides(hydrated, undefined, "RR");
        const llSides = millExportSides(hydrated, undefined, "LL");
        expect(rrSides).toEqual([internalRight, internalRight]);
        expect(llSides).toEqual([internalLeft, internalLeft]);

        const preparedRr = serverMill("prepare", doc, "RR");
        expect(preparedRr.sides).toEqual(rrSides);

        const settingsJson = doc.settingsJson;
        const printRecipe = {
            version: 1 as const,
            pattern: "gyroid" as const,
            profileId: "apex-v2-insole-95a",
            defaultHardness: "Hard" as const,
            zones: [],
        };
        const lrSides = ["left", "right"] as const;
        const lrIdentity = cadOperatorManufacturingIdentity({
            designId: DESIGN_ID,
            side: "left",
            presetId: CNC_GCODE_PRESET_ID,
            useSavedDesignMesh: true,
            material: "EVA",
            beltAngleDeg: 0,
            layerHeightMm: null,
            printRecipe,
            settingsJson,
            stlStorageKey: null,
            deliverable: "cnc_gcode",
            millSides: [...lrSides],
        });
        const rrIdentity = cadOperatorManufacturingIdentity({
            designId: DESIGN_ID,
            side: "left",
            presetId: CNC_GCODE_PRESET_ID,
            useSavedDesignMesh: true,
            material: "EVA",
            beltAngleDeg: 0,
            layerHeightMm: null,
            printRecipe,
            settingsJson,
            stlStorageKey: null,
            deliverable: "cnc_gcode",
            millSides: rrSides,
        });
        const lrKey = cncIdempotencyKey(DESIGN_ID, [...lrSides], lrIdentity.fingerprint);
        const rrKey = cncIdempotencyKey(DESIGN_ID, rrSides, rrIdentity.fingerprint);
        expect(rrKey).not.toBe(lrKey);

        expect(
            cncPairGcodeFilename({
                firstName: "Ada",
                lastName: "Lovelace",
                material: "EVA Milled",
                sides: rrSides,
                millSide: "RR",
            }),
        ).toBe("Ada_Lovelace_EVA_RR.gcode");
        expect(
            cncPairGcodeFilename({
                firstName: "Ada",
                lastName: "Lovelace",
                material: "EVA Milled",
                sides: llSides,
                millSide: "LL",
            }),
        ).toBe("Ada_Lovelace_EVA_LL.gcode");

        const browserRr = await buildMillCncGcode({
            design: hydrated,
            profile: cloneProfile(IDAHO_PROFILE),
            placements: useMillingProfileStore.getState().placements,
            millSide: "RR",
        });
        const serverRr = serverMill("gcode", doc, "RR");
        expect(serverRr.ok).toBe(true);
        expect(serverRr.sides).toEqual(rrSides);
        expect(Buffer.from(serverRr.gcode ?? "", "utf8").equals(Buffer.from(browserRr.gcode, "utf8"))).toBe(
            true,
        );

        const browserLl = await buildMillCncGcode({
            design: hydrated,
            profile: cloneProfile(IDAHO_PROFILE),
            placements: useMillingProfileStore.getState().placements,
            millSide: "LL",
        });
        const serverLl = serverMill("gcode", doc, "LL");
        expect(serverLl.ok).toBe(true);
        expect(serverLl.sides).toEqual(llSides);
        expect(Buffer.from(serverLl.gcode ?? "", "utf8").equals(Buffer.from(browserLl.gcode, "utf8"))).toBe(
            true,
        );
    }, 300_000);

    test("omitted and LR millSide stay byte-identical to the default pair export", async () => {
        await ensureCncBundle();
        useMillingProfileStore.setState({ profile: cloneProfile(IDAHO_PROFILE), placements: [] });
        const design = pairedMillDesign();
        const doc = savedDocument(design);
        const hydrated = designStateFromDocument(doc);
        installSampleTopFetch(new Uint8Array(readFileSync(SAMPLE_TOP)));
        Cache.clear();

        const browserDefault = await buildMillCncGcode({
            design: hydrated,
            profile: cloneProfile(IDAHO_PROFILE),
            placements: useMillingProfileStore.getState().placements,
            requestedSides: orderDownloadSides(hydrated),
        });
        const browserLr = await buildMillCncGcode({
            design: hydrated,
            profile: cloneProfile(IDAHO_PROFILE),
            placements: useMillingProfileStore.getState().placements,
            requestedSides: orderDownloadSides(hydrated),
            millSide: "LR",
        });

        const serverDefault = serverMill("gcode", doc);
        const serverLr = serverMill("gcode", doc, "LR");
        for (const server of [serverDefault, serverLr]) {
            expect(server.ok).toBe(true);
            expect(server.sides).toEqual(["left", "right"]);
            expect(
                Buffer.from(server.gcode ?? "", "utf8").equals(Buffer.from(browserDefault.gcode, "utf8")),
            ).toBe(true);
        }
        expect(Buffer.from(browserLr.gcode, "utf8").equals(Buffer.from(browserDefault.gcode, "utf8"))).toBe(
            true,
        );
    }, 300_000);
});
