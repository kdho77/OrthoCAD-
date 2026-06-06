// Minimal G-code builder shared by the FDM slicer and the CNC toolpath
// generator. Tracks extrusion / travel distance so we can estimate print time
// and material usage.

export interface GcodeStats {
    lines: number;
    extrudeDistanceMm: number;
    travelDistanceMm: number;
    estimatedTimeSec: number;
    estimatedMaterialMm3: number;
}

export class GcodeBuilder {
    private out: string[] = [];
    private x = 0;
    private y = 0;
    private z = 0;
    private e = 0;
    private extrudeDist = 0;
    private travelDist = 0;
    private timeSec = 0;

    constructor(
        private readonly filamentDiaMm = 1.75,
        private readonly extrusionWidthMm = 0.6,
        private readonly layerHeightMm = 0.3,
    ) {}

    comment(text: string): void {
        this.out.push(`; ${text}`);
    }

    raw(line: string): void {
        this.out.push(line);
    }

    private dist(x: number, y: number, z: number): number {
        return Math.hypot(x - this.x, y - this.y, z - this.z);
    }

    /** Rapid / travel move (no extrusion). feed in mm/min. */
    travel(x: number, y: number, z: number, feed: number): void {
        const d = this.dist(x, y, z);
        this.travelDist += d;
        this.timeSec += (d / feed) * 60;
        this.out.push(`G0 X${f(x)} Y${f(y)} Z${f(z)} F${Math.round(feed)}`);
        this.x = x;
        this.y = y;
        this.z = z;
    }

    /** Extruding move for FDM. Computes E from the volumetric flow. */
    extrudeTo(x: number, y: number, z: number, feed: number): void {
        const d = this.dist(x, y, z);
        // Volume of the deposited bead ≈ width * height * length.
        const volume = this.extrusionWidthMm * this.layerHeightMm * d;
        const filamentArea = Math.PI * (this.filamentDiaMm / 2) ** 2;
        this.e += volume / filamentArea;
        this.extrudeDist += d;
        this.timeSec += (d / feed) * 60;
        this.out.push(`G1 X${f(x)} Y${f(y)} Z${f(z)} E${f(this.e, 5)} F${Math.round(feed)}`);
        this.x = x;
        this.y = y;
        this.z = z;
    }

    /** Cutting move for CNC (linear, no extrusion). */
    cutTo(x: number, y: number, z: number, feed: number): void {
        const d = this.dist(x, y, z);
        this.travelDist += d;
        this.timeSec += (d / feed) * 60;
        this.out.push(`G1 X${f(x)} Y${f(y)} Z${f(z)} F${Math.round(feed)}`);
        this.x = x;
        this.y = y;
        this.z = z;
    }

    toString(): string {
        return this.out.join("\n") + "\n";
    }

    stats(): GcodeStats {
        const filamentArea = Math.PI * (this.filamentDiaMm / 2) ** 2;
        return {
            lines: this.out.length,
            extrudeDistanceMm: this.extrudeDist,
            travelDistanceMm: this.travelDist,
            estimatedTimeSec: this.timeSec,
            estimatedMaterialMm3: this.e * filamentArea,
        };
    }
}

function f(n: number, digits = 3): string {
    return Number.isFinite(n) ? n.toFixed(digits) : "0";
}
