// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { appendFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "@rstest/core";
import type { Side } from "@/types";
import { exportClosed, SIDES } from "./helpers/s1-ring-export.harness";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

/** Men's US catalog from 1 through 15, half sizes included. */
const US_MEN_1_TO_15 = Array.from({ length: 29 }, (_, i) => 1 + i * 0.5);

function reportsDihedral(usMen: number, side: Side): boolean {
    return usMen === 7.5 || usMen === 12 || (usMen === 11.5 && side === "left");
}

describe("S1 shell quality", () => {
    test("US 1-15 L/R straight shells keep min edge, aspect, and the named dihedrals", async () => {
        const priority = new Set([7.5, 9, 11.5, 12]);
        const order = [
            ...US_MEN_1_TO_15.filter((us) => priority.has(us)),
            ...US_MEN_1_TO_15.filter((us) => !priority.has(us)),
        ];
        const failures: string[] = [];
        const dihedral: Array<{ usMen: number; side: Side; worstDihedralDeg: number }> = [];
        for (const usMen of order) {
            for (const side of SIDES) {
                const label = `US ${usMen} ${side}`;
                let solid: Awaited<ReturnType<typeof exportClosed>>;
                try {
                    solid = await exportClosed(usMen, side, "straight", "");
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    failures.push(`${label} export threw ${message}`);
                    appendFileSync("/tmp/s1-quality.jsonl", `${JSON.stringify({ label, error: message })}\n`);
                    continue;
                }
                const row = {
                    label,
                    watertight: solid.watertight,
                    euler: solid.euler,
                    triangles: solid.triangles,
                    minEdgeMm: solid.minEdgeMm,
                    maxAspect: solid.maxAspect,
                    aspectsOver10: solid.aspectsOver10,
                    topOver10: solid.topOver10,
                    generatedOver10: solid.generatedOver10,
                    over20: solid.over20,
                    over100: solid.over100,
                    over1000: solid.over1000,
                    worstDihedralDeg: solid.worstDihedralDeg,
                    minEdgeA: solid.minEdgeA,
                    minEdgeB: solid.minEdgeB,
                    topVertexCount: solid.topVertexCount,
                    shortInTop:
                        solid.topVertexCount > 0 &&
                        solid.minEdgeA < solid.topVertexCount &&
                        solid.minEdgeB < solid.topVertexCount,
                };
                appendFileSync("/tmp/s1-quality.jsonl", `${JSON.stringify(row)}\n`);
                if (!solid.watertight || solid.euler !== 2) {
                    failures.push(`${label} watertight=${solid.watertight} euler=${solid.euler}`);
                }
                if (!(solid.minEdgeMm > 1e-4)) {
                    failures.push(`${label} min edge ${solid.minEdgeMm} mm`);
                }
                if (solid.maxAspect > 10) {
                    failures.push(`${label} aspect ${solid.maxAspect}`);
                }
                if (reportsDihedral(usMen, side)) {
                    dihedral.push({
                        usMen,
                        side,
                        worstDihedralDeg: solid.worstDihedralDeg,
                    });
                    if (solid.worstDihedralDeg > 60) {
                        failures.push(`${label} dihedral ${solid.worstDihedralDeg.toFixed(3)} deg`);
                    }
                }
            }
        }
        console.log(`S1_DIHEDRAL_REPORT ${JSON.stringify(dihedral)}`);
        expect(failures, failures.join("\n")).toEqual([]);
    }, 5_400_000);
});
