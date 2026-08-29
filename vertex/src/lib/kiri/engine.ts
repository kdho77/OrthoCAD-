import type { BufferGeometry } from "three";
import type { Side } from "@/types";
import { emitBeltFdm } from "./belt-export";
import { cncToolpath } from "./cnc";
import { GcodeBuilder, type GcodeStats } from "./gcode";
import type { PrinterPreset } from "./presets";
import { type Move, sliceFdm } from "./slicer";

// Orchestrates slicing / CAM and emits G-code. The belt transform converts
// planar model coordinates into 45°-belt machine coordinates.

export interface CamOverrides {
    layerHeightMm?: number;
    infillDensity?: number;
    perimeters?: number;
    toolDiameterMm?: number;
    side?: Side;
}

export interface CamResult {
    gcode: string;
    stats: GcodeStats;
    moveCount: number;
}

const DEG = Math.PI / 180;

/** BlackBelt-style belt transform for a gantry tilted at `angleDeg` from the belt. */
function beltTransform(x: number, y: number, z: number, angleDeg: number): [number, number, number] {
    const t = angleDeg * DEG;
    return [x, y - z / Math.tan(t), z / Math.sin(t)];
}

function emitFdm(moves: Move[], preset: PrinterPreset, o: CamOverrides): CamResult {
    const layerHeight = o.layerHeightMm ?? preset.layerHeightMm ?? 0.3;
    const nozzle = preset.nozzleMm ?? 0.4;
    const width = nozzle * 1.2;
    const belt = preset.beltAngleDeg;

    const g = new GcodeBuilder(1.75, width, layerHeight);
    const printFeed = 1800;
    const travelFeed = 6000;

    g.comment(`Vertex Web CAD — FDM (${preset.name})`);
    g.comment(`material ${preset.material ?? "TPU"} · layer ${layerHeight}mm · nozzle ${nozzle}mm`);
    if (belt) g.comment(`belt printer · gantry ${belt}°`);
    g.raw("G21");
    g.raw("G90");
    g.raw("M82");
    g.raw("M104 S230");
    g.raw("M109 S230");
    g.raw("G92 E0");

    const tx = (m: Move): [number, number, number] =>
        belt ? beltTransform(m.x, m.y, m.z, belt) : [m.x, m.y, m.z];

    for (const m of moves) {
        const [x, y, z] = tx(m);
        if (m.type === "travel") g.travel(x, y, z, travelFeed);
        else g.extrudeTo(x, y, z, printFeed);
    }

    g.raw("M104 S0");
    g.raw("M140 S0");
    g.raw("G91");
    g.raw("G1 Z5 F3000");
    g.raw("G90");
    g.comment("end");

    return { gcode: g.toString(), stats: g.stats(), moveCount: moves.length };
}

function emitCnc(moves: Move[], preset: PrinterPreset): CamResult {
    const g = new GcodeBuilder();
    const cutFeed = 800;
    const rapidFeed = 3000;

    g.comment(`Vertex Web CAD — 3-axis CNC (${preset.name})`);
    g.raw("G21");
    g.raw("G90");
    g.raw("M3 S12000");

    for (const m of moves) {
        if (m.type === "travel") g.travel(m.x, m.y, m.z, rapidFeed);
        else g.cutTo(m.x, m.y, m.z, cutFeed);
    }

    g.raw("M5");
    g.comment("end");
    return { gcode: g.toString(), stats: g.stats(), moveCount: moves.length };
}

export function generateGcode(geometry: BufferGeometry, preset: PrinterPreset, o: CamOverrides = {}): CamResult {
    if (preset.method === "milling_3axis") {
        const moves = cncToolpath(geometry, {
            toolDiameterMm: o.toolDiameterMm ?? 6,
            stepoverFraction: 0.4,
            clearanceMm: 5,
            sampleMm: 1.5,
        });
        return emitCnc(moves, preset);
    }

    if (preset.beltAngleDeg) {
        return emitBeltFdm(geometry, preset, o);
    }

    const moves = sliceFdm(geometry, {
        layerHeightMm: o.layerHeightMm ?? preset.layerHeightMm ?? 0.3,
        perimeters: o.perimeters ?? 2,
        infillDensity: o.infillDensity ?? (preset.method === "printing_shell" ? 0.0 : 0.25),
        extrusionWidthMm: (preset.nozzleMm ?? 0.4) * 1.2,
    });
    return emitFdm(moves, preset, o);
}
