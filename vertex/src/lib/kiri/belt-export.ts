// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { Side } from "@/types";
import { applyXRotationToGeometry, orientMeshToBeltFrame } from "./belt-orient";
import {
    applyAxisMap,
    type BeltAxis,
    type BeltTransformConfig,
    BeltBoundsError,
    extrusionPerMm,
    resolveBeltConfig,
    sliceFrameToMachine,
    slicePitchRotatedMm,
    SlicePlaneError,
} from "./belt-transform";
import type { GcodeStats } from "./gcode";
import type { PrinterPreset } from "./presets";
import { type Move, sliceFdm } from "./slicer";

export interface BeltCamOverrides {
    layerHeightMm?: number;
    infillDensity?: number;
    perimeters?: number;
    side?: Side;
}

export interface BeltCamResult {
    gcode: string;
    stats: GcodeStats;
    moveCount: number;
}

interface LayerPath {
    planeZ: number;
    beltZ: number;
    sections: { type: "WALL-OUTER" | "WALL-INNER" | "FILL"; moves: Move[] }[];
}

export function emitBeltFdm(geometry: BufferGeometry, preset: PrinterPreset, o: BeltCamOverrides): BeltCamResult {
    const cfg = resolveBeltConfig(preset, o);
    const framed = orientMeshToBeltFrame(geometry, o.side, cfg);
    assertBounds(framed.widthMm, framed.heightMm, cfg);

    const rotated = applyXRotationToGeometry(framed.geometry, cfg);
    const pitch = slicePitchRotatedMm(cfg);
    const moves = sliceFdm(rotated, {
        layerHeightMm: pitch,
        perimeters: o.perimeters ?? (preset.method === "printing_shell" ? 1 : 2),
        infillDensity: o.infillDensity ?? (preset.method === "printing_shell" ? 0 : 0.25),
        extrusionWidthMm: cfg.lineWidthMm,
    });
    framed.geometry.dispose();
    rotated.dispose();

    const layers = groupLayers(moves, cfg);
    if (layers.length === 0) {
        throw new SlicePlaneError(0, "Belt slice produced no layers");
    }

    const ePerMm = extrusionPerMm(cfg);
    const letters = cfg.beltAxisMap;
    const meshName = `insole-${framed.side}`;

    const body: string[] = [];
    let x = 0;
    let y = 0;
    let extrudeMm = 0;
    let travelMm = 0;
    let timeSec = 0;
    let eFilament = 0;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [layers[0].beltZ];

    const emit = (line: string) => {
        body.push(line);
    };

    x = firstXY(layers[0], cfg).x;
    y = firstXY(layers[0], cfg).y;
    emit(`G0 F600 ${word(letters.across, x)} ${word(letters.gantry, y)} ${word(letters.belt, layers[0].beltZ)}`);

    for (let n = 0; n < layers.length; n++) {
        const layer = layers[n];
        const printFeed = feedForLayer(n, "print", cfg);
        const fillFeed = n === 1 ? 1400 : printFeed;
        const wallTravel = n === 0 ? 360 : 15000;
        emit(`;LAYER:${n}`);
        emit(`M204 S${cfg.accelPrint}`);
        emit(fanLine(n));
        emit(`;MESH:${meshName}`);

        for (const section of layer.sections) {
            emit(`;TYPE:${section.type}`);
            const sectionFeed = section.type === "FILL" ? fillFeed : printFeed;
            for (const mv of section.moves) {
                const m = sliceFrameToMachine({ x: mv.x, y: mv.y, z: mv.z }, cfg);
                assertFinite(m.across, m.gantry, layer.planeZ);
                const mapped = applyAxisMap({ ...m, belt: layer.beltZ }, letters);
                const nx = mapped[letters.across];
                const ny = mapped[letters.gantry];
                const d = Math.hypot(nx - x, ny - y);
                if (mv.type === "travel") {
                    emit(`M204 S${cfg.accelTravel}`);
                    const tf = d > 5 ? 15000 : wallTravel;
                    emit(`G0 F${tf} ${word(letters.across, nx)} ${word(letters.gantry, ny)}`);
                    travelMm += d;
                    timeSec += (d / tf) * 60;
                    emit(`M204 S${cfg.accelPrint}`);
                } else {
                    const e = d * ePerMm;
                    emit(
                        `G1 F${sectionFeed} ${word(letters.across, nx)} ${word(letters.gantry, ny)} E${e.toFixed(5)}`,
                    );
                    extrudeMm += d;
                    eFilament += e;
                    timeSec += (d / sectionFeed) * 60;
                }
                x = nx;
                y = ny;
                xs.push(nx);
                ys.push(ny);
            }
        }

        const nextZ = n + 1 < layers.length ? layers[n + 1].beltZ : layer.beltZ + cfg.layerHeightMm;
        zs.push(nextZ);
        emit(";MESH:NONMESH");
        emit(`G0 F600 ${word(letters.across, x)} ${word(letters.gantry, y)} ${word(letters.belt, nextZ)}`);
        emit(`;TIME_ELAPSED:${timeSec.toFixed(5)}`);
    }

    const minx = minOf(xs);
    const maxx = maxOf(xs);
    const miny = minOf(ys);
    const maxy = maxOf(ys);
    const minz = minOf(zs);
    const maxz = maxOf(zs);

    const header = buildPreamble(preset, cfg, {
        layerCount: layers.length,
        timeSec,
        minx,
        maxx,
        miny,
        maxy,
        minz,
        maxz,
    });
    const footer = buildPostamble(cfg);
    const gcode = [...header, ...body, ...footer].join("\n") + "\n";

    const filamentArea = Math.PI * (cfg.filamentDiameterMm / 2) ** 2;
    const stats: GcodeStats = {
        lines: header.length + body.length + footer.length,
        extrudeDistanceMm: extrudeMm,
        travelDistanceMm: travelMm,
        estimatedTimeSec: timeSec,
        estimatedMaterialMm3: eFilament * filamentArea,
    };
    return { gcode, stats, moveCount: moves.length };
}

function assertBounds(widthMm: number, heightMm: number, cfg: BeltTransformConfig): void {
    const t = (cfg.beltGantryAngleDeg * Math.PI) / 180;
    const commandedGantry = heightMm / Math.sin(t);
    if (widthMm > cfg.beltWidthMm) {
        throw new BeltBoundsError(
            `Part across-axis width ${widthMm.toFixed(2)} mm exceeds belt width limit ${cfg.beltWidthMm} mm`,
        );
    }
    if (commandedGantry > cfg.gantryStrokeMm) {
        throw new BeltBoundsError(
            `Part height ${heightMm.toFixed(2)} mm commands gantry extent ${commandedGantry.toFixed(2)} mm ` +
                `(H/sinθ) which exceeds gantry stroke ${cfg.gantryStrokeMm} mm`,
        );
    }
}

function groupLayers(moves: Move[], cfg: BeltTransformConfig): LayerPath[] {
    const groups = new Map<string, Move[]>();
    const order: number[] = [];
    for (const mv of moves) {
        if (!Number.isFinite(mv.x) || !Number.isFinite(mv.y) || !Number.isFinite(mv.z)) {
            throw new SlicePlaneError(mv.z, `Failed slice at plane z=${mv.z}: NaN coordinate`);
        }
        const key = mv.z.toFixed(6);
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(mv.z);
        }
        groups.get(key)!.push(mv);
    }

    const layers: LayerPath[] = [];
    for (const z of order) {
        const planeMoves = groups.get(z.toFixed(6))!;
        const sections = classifySections(planeMoves);
        if (sections.length === 0) continue;
        const beltZ = sliceFrameToMachine({ x: 0, y: 0, z }, cfg).belt;
        layers.push({ planeZ: z, beltZ, sections });
    }
    return layers;
}

function classifySections(moves: Move[]): LayerPath["sections"] {
    const sections: LayerPath["sections"] = [];
    let i = 0;
    let walls = 0;
    while (i < moves.length) {
        if (moves[i].type !== "travel") {
            i++;
            continue;
        }
        const chunk: Move[] = [moves[i]];
        i++;
        while (i < moves.length && moves[i].type === "extrude") {
            chunk.push(moves[i]);
            i++;
        }
        if (chunk.length < 2) continue;
        const closed = chunk.length >= 4;
        let type: LayerPath["sections"][number]["type"];
        if (closed) {
            type = walls === 0 ? "WALL-OUTER" : "WALL-INNER";
            walls++;
        } else {
            type = "FILL";
        }
        const last = sections[sections.length - 1];
        if (last && last.type === type && type === "FILL") last.moves.push(...chunk);
        else sections.push({ type, moves: chunk });
    }
    return sections;
}

function firstXY(layer: LayerPath, cfg: BeltTransformConfig): { x: number; y: number } {
    const mv = layer.sections[0].moves[0];
    const m = sliceFrameToMachine({ x: mv.x, y: mv.y, z: mv.z }, cfg);
    const mapped = applyAxisMap({ ...m, belt: layer.beltZ }, cfg.beltAxisMap);
    return { x: mapped[cfg.beltAxisMap.across], y: mapped[cfg.beltAxisMap.gantry] };
}

function feedForLayer(n: number, _kind: "print", cfg: BeltTransformConfig): number {
    if (n === 0) return Math.round(1800 * cfg.firstLayerFeedScale);
    if (n === 1) return 1000;
    return 1800;
}

function fanLine(n: number): string {
    if (n === 0) return "M107";
    const pwm = Math.min(255, 64 * n);
    return `M106 S${pwm}`;
}

function word(axis: BeltAxis, v: number): string {
    return `${axis}${v.toFixed(3)}`;
}

function assertFinite(a: number, b: number, planeZ: number): void {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new SlicePlaneError(planeZ, `Failed slice at plane z=${planeZ}: non-finite machine coordinate`);
    }
}

function minOf(a: number[]): number {
    return a.length ? Math.min(...a) : 0;
}
function maxOf(a: number[]): number {
    return a.length ? Math.max(...a) : 0;
}

function buildPreamble(
    preset: PrinterPreset,
    cfg: BeltTransformConfig,
    b: {
        layerCount: number;
        timeSec: number;
        minx: number;
        maxx: number;
        miny: number;
        maxy: number;
        minz: number;
        maxz: number;
    },
): string[] {
    const nozzle = cfg.nozzleDiameterMm;
    return [
        "PRINT_START",
        `;Material: ${preset.material ?? "TPU 95A"}`,
        `;Nozzle: ${nozzle}`,
        ";FLAVOR:Marlin",
        `;TIME:${Math.max(1, Math.round(b.timeSec))}`,
        `;Layer height: ${cfg.layerHeightMm}`,
        `;MINX:${b.minx.toFixed(3)}`,
        `;MINY:${b.miny.toFixed(3)}`,
        `;MINZ:${b.minz.toFixed(3)}`,
        `;MAXX:${b.maxx.toFixed(3)}`,
        `;MAXY:${b.maxy.toFixed(3)}`,
        `;MAXZ:${b.maxz.toFixed(3)}`,
        ";TARGET_MACHINE.NAME:IdeaFormer Printer",
        `M104 S${cfg.nozzleTempC}`,
        "M105",
        `M109 S${cfg.nozzleTempC}`,
        "M82 ;absolute extrusion mode",
        "M83 ;relative extrusion mode",
        `;LAYER_COUNT:${b.layerCount}`,
    ];
}

function buildPostamble(cfg: BeltTransformConfig): string[] {
    return [
        `M204 S${cfg.accelEnd}`,
        "M82",
        "M107",
        "G92 E0",
        "G1 E-1",
        "G90",
        "G91",
        "G92 Z0",
        "G28 Y",
        "G28 X",
        "M104 S0",
        "M140 S0",
        "G92 Z0",
        "M82",
        "M104 S0",
        ";End of Gcode",
        "PRINT_END",
    ];
}

export function measureGcodeEnvelope(gcode: string): {
    layerCount: number;
    beltSteps: number[];
    xSpan: number;
    ySpan: number;
    zSpan: number;
    minZ: number;
    maxZ: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    layersYMin: number[];
    yMaxLayerIndex: number;
    retractCount: number;
    hasNaN: boolean;
} {
    const layerRe = /^;LAYER:(\d+)/;
    const countRe = /^;LAYER_COUNT:(\d+)/;
    let declared = 0;
    let seen = 0;
    const beltZs: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const yMinByLayer: number[] = [];
    let curLayer = -1;
    let yMax = -Infinity;
    let yMaxLayer = 0;
    let retractCount = 0;
    let hasNaN = false;

    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        const cm = countRe.exec(line);
        if (cm) declared = Number(cm[1]);
        const lm = layerRe.exec(line);
        if (lm) {
            curLayer = Number(lm[1]);
            seen = Math.max(seen, curLayer + 1);
            if (yMinByLayer[curLayer] === undefined) yMinByLayer[curLayer] = Infinity;
        }
        if (/\bNaN\b|\bInfinity\b/i.test(line)) hasNaN = true;
        if (/^G1 E-/.test(line)) retractCount++;
        if (!/^G[01]\b/.test(line)) continue;
        const x = numWord(line, "X");
        const y = numWord(line, "Y");
        const z = numWord(line, "Z");
        if (x !== undefined) xs.push(x);
        if (y !== undefined) {
            ys.push(y);
            if (curLayer >= 0) yMinByLayer[curLayer] = Math.min(yMinByLayer[curLayer] ?? Infinity, y);
            if (y > yMax) {
                yMax = y;
                yMaxLayer = Math.max(0, curLayer);
            }
        }
        if (z !== undefined) {
            zs.push(z);
            beltZs.push(z);
        }
    }

    const layerCount = declared || seen;
    const beltSteps: number[] = [];
    for (let i = 1; i < beltZs.length; i++) beltSteps.push(beltZs[i] - beltZs[i - 1]);

    return {
        layerCount,
        beltSteps,
        xSpan: span(xs),
        ySpan: span(ys),
        zSpan: span(zs),
        minZ: zs.length ? Math.min(...zs) : 0,
        maxZ: zs.length ? Math.max(...zs) : 0,
        minX: xs.length ? Math.min(...xs) : 0,
        maxX: xs.length ? Math.max(...xs) : 0,
        minY: ys.length ? Math.min(...ys) : 0,
        maxY: ys.length ? Math.max(...ys) : 0,
        layersYMin: yMinByLayer.map((v) => (v === Infinity ? Number.NaN : v)),
        yMaxLayerIndex: yMaxLayer,
        retractCount,
        hasNaN,
    };
}

function numWord(line: string, axis: string): number | undefined {
    const m = new RegExp(`(?:^|\\s)${axis}(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)`, "i").exec(line);
    return m ? Number(m[1]) : undefined;
}

function span(a: number[]): number {
    return a.length ? Math.max(...a) - Math.min(...a) : 0;
}
