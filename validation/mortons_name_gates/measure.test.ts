// Geometry measurement for the frozen Morton's-name gates.
// Records facts only. Pass/fail is score.mjs, which is frozen before the candidate run.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { TextMarkingError } from "@/lib/geometry/text-marking/errors";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import {
    FLOOR_MIN_ABS_NZ,
    FLOOR_Z_MAX_MM,
    FLOOR_Z_MIN_MM,
    KIRI_FILES,
    MARKING_TEXT,
    STOCK_FIXTURES,
    SURFACE_CELL_MM,
    SURFACE_Z_MIN_MM,
} from "./thresholds.mjs";

const BASE_SHA = "268aac85847160b5b2703a05688721ea4cb93b24";
const FIXTURE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

const MARKING = {
    ...defaultTextMarking("bottom"),
    text: MARKING_TEXT,
    addPatientName: false,
    feet: "both" as const,
    surface: "bottom" as const,
    mode: "engrave" as const,
};

function zero(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(side: Side, elements: PlacedElement[]): HeightFieldParams {
    return {
        side,
        lengthMm: INSOLE_LENGTH_MM,
        widthMm: INSOLE_WIDTH_MM,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements,
        includeSkives: false,
        includeElements: true,
        trimline: null,
        shellThicknessMode: "zonal",
        shellThicknessRfMm: 3,
        shellThicknessMfMm: 2.5,
        shellThicknessFfMm: 2,
        shellThicknessBlendMm: 12,
        method: "printing_solid",
    };
}

function sha256(bytes: Buffer | Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path: string): string {
    return sha256(readFileSync(path));
}

function git(args: string): string {
    return execSync(`git ${args}`, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    }).trim();
}

function addedDiffLines(): string[] {
    let patch = "";
    try {
        patch = execSync(`git diff -U0 ${BASE_SHA} --`, {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch {
        patch = "";
    }
    return patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

/** Built so this source file does not itself match the pattern. */
function secretPattern(): RegExp {
    return new RegExp(
        ["api[_-]?", "key|bearer\\s+[A-Za-z0-9._-]{8,}|sk_", "live_|AKIA[0-9A-Z]{16}"].join(""),
        "i",
    );
}

function scanAddedLines(lines: string[]): { secretHits: number; phiHits: number } {
    const secret = secretPattern();
    const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const phone = /\b\d{3}[-.]\d{3}[-.]\d{4}\b/;
    let secretHits = 0;
    let phiHits = 0;
    for (const line of lines) {
        if (secret.test(line)) secretHits++;
        if (email.test(line) || phone.test(line)) phiHits++;
    }
    return { secretHits, phiHits };
}

function stlSha(geo: BufferGeometry): string {
    return sha256(Buffer.from(geometryToBinarySTL(geo)));
}

function triangleCount(geo: BufferGeometry): number {
    const index = geo.getIndex();
    const pos = geo.getAttribute("position");
    if (!pos) return 0;
    return index ? index.count / 3 : pos.count / 3;
}

function maxZGrid(geo: BufferGeometry, zMin: number): Record<string, number> {
    const pos = geo.getAttribute("position");
    const grid: Record<string, number> = {};
    if (!pos) return grid;
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z < zMin) continue;
        const key = `${Math.round(pos.getX(i) / SURFACE_CELL_MM)}|${Math.round(pos.getY(i) / SURFACE_CELL_MM)}`;
        const prev = grid[key];
        const rounded = Math.round(z * 1000) / 1000;
        if (prev == null || rounded > prev) grid[key] = rounded;
    }
    return grid;
}

function raiseAgainstStock(
    morton: BufferGeometry,
    stock: Record<string, number>,
): { maxRaiseMm: number; raisedMeanY: number | null; raisedCount: number } {
    const pos = morton.getAttribute("position");
    let maxRaise = 0;
    let sumY = 0;
    let n = 0;
    if (!pos) return { maxRaiseMm: 0, raisedMeanY: null, raisedCount: 0 };
    for (let i = 0; i < pos.count; i++) {
        const key = `${Math.round(pos.getX(i) / SURFACE_CELL_MM)}|${Math.round(pos.getY(i) / SURFACE_CELL_MM)}`;
        const baseZ = stock[key];
        if (baseZ == null) continue;
        const delta = pos.getZ(i) - baseZ;
        if (delta > maxRaise) maxRaise = delta;
        if (delta > 1) {
            sumY += pos.getY(i);
            n++;
        }
    }
    return {
        maxRaiseMm: Math.round(maxRaise * 1000) / 1000,
        raisedMeanY: n ? Math.round((sumY / n) * 1000) / 1000 : null,
        raisedCount: n,
    };
}

function floorOf(geo: BufferGeometry) {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const empty = {
        areaMm2: 0,
        triCount: 0,
        centroid: [0, 0, 0] as [number, number, number],
        spanX: 0,
        spanY: 0,
        axisDeg: 0,
    };
    if (!pos) return empty;
    const tris = index ? index.count / 3 : pos.count / 3;
    const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    let area = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let floorTris = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let vx = 0;
    let vy = 0;
    const samples: Array<{ x: number; y: number }> = [];
    for (let t = 0; t < tris; t++) {
        const a = at(t, 0);
        const b = at(t, 1);
        const c = at(t, 2);
        const z0 = pos.getZ(a);
        const z1 = pos.getZ(b);
        const z2 = pos.getZ(c);
        if (z0 < FLOOR_Z_MIN_MM || z0 > FLOOR_Z_MAX_MM) continue;
        if (z1 < FLOOR_Z_MIN_MM || z1 > FLOOR_Z_MAX_MM) continue;
        if (z2 < FLOOR_Z_MIN_MM || z2 > FLOOR_Z_MAX_MM) continue;
        const x0 = pos.getX(a);
        const y0 = pos.getY(a);
        const x1 = pos.getX(b);
        const y1 = pos.getY(b);
        const x2 = pos.getX(c);
        const y2 = pos.getY(c);
        const ux = x1 - x0;
        const uy = y1 - y0;
        const uz = z1 - z0;
        const wx = x2 - x0;
        const wy = y2 - y0;
        const wz = z2 - z0;
        const nx = uy * wz - uz * wy;
        const ny = uz * wx - ux * wz;
        const nz = ux * wy - uy * wx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-8 || Math.abs(nz) / len < FLOOR_MIN_ABS_NZ) continue;
        const face = len * 0.5;
        area += face;
        floorTris++;
        cx += ((x0 + x1 + x2) / 3) * face;
        cy += ((y0 + y1 + y2) / 3) * face;
        cz += ((z0 + z1 + z2) / 3) * face;
        for (const [x, y] of [
            [x0, y0],
            [x1, y1],
            [x2, y2],
        ] as const) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            samples.push({ x, y });
        }
    }
    if (area < 1e-6 || samples.length === 0) return empty;
    for (const p of samples) {
        vx += p.x;
        vy += p.y;
    }
    vx /= samples.length;
    vy /= samples.length;
    for (const p of samples) {
        const dx = p.x - vx;
        const dy = p.y - vy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    const axis = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
    return {
        areaMm2: Math.round(area * 1000) / 1000,
        triCount: floorTris,
        centroid: [
            Math.round((cx / area) * 1000) / 1000,
            Math.round((cy / area) * 1000) / 1000,
            Math.round((cz / area) * 1000) / 1000,
        ] as [number, number, number],
        spanX: Math.round((maxX - minX) * 1000) / 1000,
        spanY: Math.round((maxY - minY) * 1000) / 1000,
        axisDeg: Math.round(axis * 1000) / 1000,
    };
}

async function loft(side: Side, elements: PlacedElement[]): Promise<BufferGeometry> {
    const buf = readFileSync(FIXTURE);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "right") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    const preview = await reconstructProceduralPreview(raw, {
        side,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
        wallStyle: "straight",
        scanPattern: "full_contact",
        deviceType: "functional",
        composedTop: true,
        sourceField: field(side, elements),
    });
    raw.dispose();
    return preview.geometry;
}

async function engrave(
    host: BufferGeometry,
    side: Side,
): Promise<{ geo: BufferGeometry; textDropped: boolean }> {
    const copy = host.clone();
    try {
        const marked = await applyTextMarkingToPrintSolid(copy, MARKING, { side, beltPrint: true }, null);
        if (marked !== copy) copy.dispose();
        return { geo: marked, textDropped: false };
    } catch (error) {
        if (!(error instanceof TextMarkingError)) {
            copy.dispose();
            throw error;
        }
        return { geo: copy, textDropped: true };
    }
}

function packCase(
    geo: BufferGeometry,
    textDropped: boolean,
    highGrid: Record<string, number>,
    raise: { maxRaiseMm: number; raisedMeanY: number | null; raisedCount: number } | null,
) {
    const floor = floorOf(geo);
    const row = {
        triCount: triangleCount(geo),
        stlSha256: stlSha(geo),
        maxZ: highGridMax(highGrid),
        textDropped,
        floor,
        highGrid,
        maxRaiseMm: raise?.maxRaiseMm ?? null,
        raisedMeanY: raise?.raisedMeanY ?? null,
        raisedCount: raise?.raisedCount ?? 0,
    };
    console.log(
        [
            `tris=${row.triCount}`,
            `floorMm2=${floor.areaMm2}`,
            `span=${floor.spanX}x${floor.spanY}`,
            `axis=${floor.axisDeg}`,
            `dropped=${textDropped}`,
            `raise=${row.maxRaiseMm}`,
            `meanY=${row.raisedMeanY}`,
        ].join(" "),
    );
    return row;
}

function highGridMax(grid: Record<string, number>): number {
    let max = 0;
    for (const z of Object.values(grid)) if (z > max) max = z;
    return max;
}

describe("mortons-name gate measurement", () => {
    test("export stock and one-foot Morton's with the existing bottom engrave", async () => {
        const pose = defaultElementPose("mortons_extension", "left", INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);
        const element: PlacedElement = {
            id: "gate-mortons-left",
            kind: "mortons_extension",
            side: "left",
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm: pose.heightMm,
            placementMode: pose.placementMode,
        };

        console.log("loft stock left");
        const stockLeft = await loft("left", []);
        const stockTop = maxZGrid(stockLeft, -1e9);
        const stockHigh = maxZGrid(stockLeft, SURFACE_Z_MIN_MM);
        console.log("case stock-left-plain");
        const stockLeftPlain = packCase(stockLeft, false, stockHigh, null);

        console.log("engrave stock left");
        const leftNamed = await engrave(stockLeft, "left");
        stockLeft.dispose();
        console.log("case stock-left-name");
        const stockLeftName = packCase(
            leftNamed.geo,
            leftNamed.textDropped,
            maxZGrid(leftNamed.geo, SURFACE_Z_MIN_MM),
            null,
        );
        leftNamed.geo.dispose();

        console.log("loft stock right");
        const stockRight = await loft("right", []);
        console.log("engrave stock right");
        const rightNamed = await engrave(stockRight, "right");
        stockRight.dispose();
        console.log("case stock-right-name");
        const stockRightName = packCase(
            rightNamed.geo,
            rightNamed.textDropped,
            maxZGrid(rightNamed.geo, SURFACE_Z_MIN_MM),
            null,
        );
        rightNamed.geo.dispose();

        console.log("loft morton left");
        const morton = await loft("left", [element]);
        const mortonRaise = raiseAgainstStock(morton, stockTop);
        const mortonHigh = maxZGrid(morton, SURFACE_Z_MIN_MM);
        console.log("case morton-left-plain");
        const mortonPlain = packCase(morton, false, mortonHigh, mortonRaise);

        console.log("engrave morton left");
        const mortonNamed = await engrave(morton, "left");
        morton.dispose();
        console.log("case morton-left-name");
        const mortonName = packCase(
            mortonNamed.geo,
            mortonNamed.textDropped,
            maxZGrid(mortonNamed.geo, SURFACE_Z_MIN_MM),
            raiseAgainstStock(mortonNamed.geo, stockTop),
        );
        mortonNamed.geo.dispose();

        const diffFiles = git(`diff --name-only ${BASE_SHA} --`).split("\n").filter(Boolean);
        const scanned = scanAddedLines(addedDiffLines());
        const fileSha256: Record<string, string> = {};
        for (const path of [...KIRI_FILES, ...STOCK_FIXTURES]) fileSha256[path] = sha256File(path);
        const branch = git("rev-parse --abbrev-ref HEAD");
        const measurement = {
            sha: git("rev-parse HEAD"),
            branch,
            baseSha: BASE_SHA,
            mergedToMain: branch === "main",
            stockFixture: "tests/fixtures/SAMPLE_Top.glb",
            fileSha256,
            diffFiles,
            secretHits: scanned.secretHits,
            phiHits: scanned.phiHits,
            marking: {
                surface: MARKING.surface,
                mode: MARKING.mode,
                depthMm: MARKING.depthMm,
                feet: MARKING.feet,
                text: MARKING.text,
                addPatientName: MARKING.addPatientName === true,
            },
            element: {
                kind: element.kind,
                side: element.side,
                heightMm: element.heightMm,
                position: element.position,
            },
            cases: {
                "stock-left-plain": stockLeftPlain,
                "stock-left-name": stockLeftName,
                "stock-right-name": stockRightName,
                "morton-left-plain": mortonPlain,
                "morton-left-name": mortonName,
            },
        };

        const outPath = resolve(
            process.cwd(),
            process.env.GATE_OUT ?? "validation/mortons_name_gates/out/measurement.json",
        );
        mkdirSync(resolve(outPath, ".."), { recursive: true });
        writeFileSync(outPath, JSON.stringify(measurement));
        console.log(`wrote ${outPath}`);
        if (stockLeftPlain.triCount < 1000) throw new Error("stock loft collapsed");
        if (mortonPlain.triCount < 1000) throw new Error("morton loft collapsed");
    }, 900_000);
});
