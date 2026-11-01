// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { FeedClass, FeedSet, MillingProfile, TaggedMove } from "./types";

export class CncGcodeEmitter {
    readonly moves: TaggedMove[] = [];
    private x = 0;
    private y = 0;
    private z = 0;
    private f: number | null = null;
    private spindleOn = false;
    private cutDist = 0;
    private travelDist = 0;
    private timeSec = 0;
    private readonly lines: string[] = [];

    constructor(private readonly profile: MillingProfile) {}

    get spindleIsOn(): boolean {
        return this.spindleOn;
    }

    fmt(n: number): string {
        return n.toFixed(this.profile.decimals);
    }

    private zOut(z: number): number {
        return z + this.profile.zOffsetCorrectionMm;
    }

    comment(text: string): void {
        this.lines.push(`; ${text}`);
        this.moves.push({ kind: "comment", text });
    }

    raw(text: string): void {
        const t = text.replace(/\s+$/g, "");
        if (!t) return;
        for (const line of t.split(/\r?\n/)) {
            if (!line.trim()) continue;
            this.lines.push(line);
            this.moves.push({ kind: "raw", text: line });
        }
    }

    rapidTo(x: number, y: number, z: number): void {
        const d = Math.hypot(x - this.x, y - this.y, z - this.z);
        this.travelDist += d;
        const feed = 6000;
        this.timeSec += (d / feed) * 60;
        this.lines.push(`G0 X${this.fmt(x)} Y${this.fmt(y)} Z${this.fmt(this.zOut(z))}`);
        this.moves.push({ kind: "rapid", x, y, z: this.zOut(z), feedClass: "rapid" });
        this.x = x;
        this.y = y;
        this.z = z;
        this.f = null;
    }

    rapidZ(z: number): void {
        this.rapidTo(this.x, this.y, z);
    }

    cutTo(x: number, y: number, z: number, feedClass: FeedClass, feeds: FeedSet): void {
        const dxy = Math.hypot(x - this.x, y - this.y);
        const dz = z - this.z;
        const d = Math.hypot(dxy, dz);
        if (d < 1e-7) return;
        // Windows stays on the surface feed after the plunge, including the heel-cup
        // climbs. The caller chooses dip / contour / normal; slope does not override it.
        const cls = feedClass;
        const f =
            cls === "dip"
                ? feeds.dip
                : cls === "slow"
                  ? feeds.slow
                  : cls === "contour"
                    ? feeds.contour
                    : feeds.normal;
        this.cutDist += d;
        this.timeSec += (d / f) * 60;
        const zc = this.zOut(z);
        let line = `G1 X${this.fmt(x)} Y${this.fmt(y)} Z${this.fmt(zc)}`;
        if (this.f !== f) {
            line += ` F${Math.round(f)}`;
            this.f = f;
        }
        this.lines.push(line);
        this.moves.push({ kind: "cut", x, y, z: zc, f, feedClass: cls });
        this.x = x;
        this.y = y;
        this.z = z;
    }

    spindle(on: boolean, rpm: number): void {
        if (on) {
            this.lines.push(`M3 S${Math.round(rpm)}`);
            this.moves.push({ kind: "spindle", s: rpm, text: "on" });
            this.spindleOn = true;
        } else {
            this.lines.push("M5");
            this.moves.push({ kind: "spindle", text: "off" });
            this.spindleOn = false;
        }
    }

    dwell(sec: number): void {
        this.lines.push(`G4 P${sec}`);
        this.moves.push({ kind: "dwell", p: sec });
        this.timeSec += sec;
    }

    pause(comment: string): void {
        this.lines.push(`M0 (${comment})`);
        this.moves.push({ kind: "pause", text: comment });
    }

    modal(): void {
        this.lines.push("G21");
        this.lines.push("G90");
        this.lines.push("G17");
        this.lines.push("G94");
    }

    end(): void {
        this.lines.push("M30");
        this.moves.push({ kind: "raw", text: "M30" });
    }

    toString(): string {
        return `${this.lines.join("\n")}\n`;
    }

    stats() {
        return {
            estimatedTimeSec: this.timeSec,
            cutDistanceMm: this.cutDist,
            travelDistanceMm: this.travelDist,
            moveCount: this.moves.length,
        };
    }
}
