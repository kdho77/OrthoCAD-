// FROZEN GATE (OrthoCAD PM, 2026-11-20). Do not edit. Verified by sha256 in run_cnc_thickness_gates.sh.
// Kendon 12:11 PM MT: "If I export the G-Code myself do I get the same result currently? It will always be too thin?"
// Milled SAMPLE_Top parts must be as thick as the design says, with nothing else changed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { buildMillCncGcode, designStateFromDocument } from "@/lib/cnc/mill-job";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import type { CncWorkpiece } from "@/lib/cnc/types";
import { getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import { buildFinalizedFootFromSavedDesign } from "../../../vertex/src/features/exports/saved-design-finalized-mesh";
import { loadSampleTop } from "../helpers";

const DIR = resolve(process.cwd(), "tests/cnc/frozen-thickness");
const DUMP = process.env.CNC_GATE_DUMP ?? "";
const SAMPLE_TOP_SHA = "2657b0a4f1a5ef1da8322f45348034ba93ecdb611f7d17c2f828206039e024d1";
// Main reference: produced by the frozen runner from base a7ef6ed9 (DUMP mode) and sha-checked before use.
const REF_DIR = process.env.CNC_GATE_REF_DIR ?? "";
const REF = DUMP ? null : JSON.parse(readFileSync(resolve(REF_DIR, "main-ref.json"), "utf8"));
const results: Array<Record<string, unknown>> = [];
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

function check(name: string, measured: number | string | boolean, bar: string, ok: boolean): void {
    results.push({ gate: name, measured, bar, pass: ok });
}

function installSampleTopFetch(bytes: Uint8Array): void {
    const orig = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = typeof input === "string" ? input : ((input as { url?: string }).url ?? String(input));
        if (/SAMPLE_Top\.glb(?:$|[?#])/i.test(url)) {
            return new Response(new Uint8Array(bytes), {
                status: 200,
                headers: { "content-type": "model/gltf-binary" },
            });
        }
        return orig(input as Parameters<typeof orig>[0], init);
    }) as typeof globalThis.fetch;
}

function freshDefault(thicknessMm: number, method: "milling_3axis" | "printing_solid"): DesignState {
    const d = createDesignWithStockPlaceholder({ ...defaultDesign(), method, thicknessMm } as DesignState);
    if (d.paired) {
        d.paired = {
            ...d.paired,
            leftThicknessMm: thicknessMm,
            rightThicknessMm: thicknessMm,
            leftMethod: method,
            rightMethod: method,
        };
    }
    return d;
}

function peavyDoc(): unknown {
    return JSON.parse(readFileSync(resolve(DIR, "peavy-6236d861.settings.json"), "utf8"));
}

function peavyZonalDoc(): unknown {
    const doc = peavyDoc() as { settingsJson: { settings: Record<string, unknown> } };
    doc.settingsJson.settings.shellThicknessMode = "zonal";
    return doc;
}

type Pt = { x: number; y: number; z: number };
function parseGcode(text: string): Record<string, Pt[]> {
    const out: Record<string, Pt[]> = {};
    let sec = "";
    let x = 0;
    let y = 0;
    let z = 0;
    for (const line of text.split("\n")) {
        if (line.startsWith(";")) {
            const m = /^; (surface|perimeter) (left|right)/.exec(line);
            if (m) sec = `${m[1]} ${m[2]}`;
            continue;
        }
        if (!line.startsWith("G0") && !line.startsWith("G1")) continue;
        for (const m of line.matchAll(/([XYZ])(-?[\d.]+)/g)) {
            const v = Number(m[2]);
            if (m[1] === "X") x = v;
            else if (m[1] === "Y") y = v;
            else z = v;
        }
        if (line.startsWith("G1") && sec) {
            if (!out[sec]) out[sec] = [];
            out[sec].push({ x, y, z });
        }
    }
    return out;
}

function inPoly(px: number, py: number, poly: Pt[]): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
}
function distPoly(px: number, py: number, poly: Pt[]): number {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j]!;
        const b = poly[i]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L = dx * dx + dy * dy;
        const t = L > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L)) : 0;
        best = Math.min(best, Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)));
    }
    return best;
}
const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1]! : Number.NaN;
};

/** Finished top above the table (Z0 = stock bottom), surface pass, interior >= 6 mm from the knife line. */
function footBands(text: string, side: Side) {
    const p = parseGcode(text);
    const outline = (p[`perimeter ${side}`] ?? []).filter((q) => q.z === 0);
    const surf = p[`surface ${side}`] ?? [];
    const xs = outline.map((q) => q.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const band = (lo: number, hi: number) =>
        surf
            .filter((q) => {
                const f = (q.x - x0) / (x1 - x0);
                return f >= lo && f < hi && inPoly(q.x, q.y, outline) && distPoly(q.x, q.y, outline) >= 6;
            })
            .map((q) => q.z);
    const toe = band(0.7, 1.0001);
    const ball = band(0.6, 0.7);
    const fore = band(0.6, 1.0001);
    const heel = band(0, 0.1);
    return {
        toeMedian: median(toe),
        ballMedian: median(ball),
        foreMin: fore.length ? Math.min(...fore) : Number.NaN,
        heelMedian: median(heel),
        n: toe.length + ball.length,
    };
}

function hmBands(wp: CncWorkpiece) {
    const hm = wp.heightmap;
    const xs = wp.outline.map((q) => q.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const bins: number[][] = Array.from({ length: 10 }, () => []);
    for (let iy = 0; iy < hm.ny; iy++)
        for (let ix = 0; ix < hm.nx; ix++) {
            const i = iy * hm.nx + ix;
            if (hm.inside[i] !== 1) continue;
            const v = hm.z[i]!;
            if (!Number.isFinite(v)) continue;
            const f = (hm.originX + ix * hm.cell - x0) / (x1 - x0);
            bins[Math.max(0, Math.min(9, Math.floor(f * 10)))]!.push(v);
        }
    return bins.map((b) => {
        const s = b.sort((a, c) => a - c);
        return {
            p10: s[Math.floor(s.length * 0.1)]!,
            p50: s[s.length >> 1]!,
            p90: s[Math.floor(s.length * 0.9)]!,
            max: s[s.length - 1]!,
        };
    });
}

function stripZ(line: string): string {
    return line.replace(/ ?Z-?[\d.]+/, "");
}

test("FROZEN CNC thickness gates", async () => {
    const fixtureBytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
    const publicBytes = readFileSync(resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb"));
    check(
        "G0 SAMPLE_Top fixture sha",
        sha(fixtureBytes),
        SAMPLE_TOP_SHA,
        sha(fixtureBytes) === SAMPLE_TOP_SHA,
    );
    check("G0 SAMPLE_Top public sha", sha(publicBytes), SAMPLE_TOP_SHA, sha(publicBytes) === SAMPLE_TOP_SHA);
    installSampleTopFetch(publicBytes);
    const fixtureRaw = await loadSampleTop();
    const fixtureLoader = async (side: Side): Promise<BufferGeometry> =>
        side === "right" ? mirrorGeometry(fixtureRaw.clone()) : fixtureRaw.clone();

    const designs: Record<string, DesignState> = {
        // Reference dump (main) uses the zonal re-save of the same design; the gate itself runs the design as saved (uniform).
        peavy4: designStateFromDocument((DUMP ? peavyZonalDoc() : peavyDoc()) as never),
        default4: freshDefault(4, "milling_3axis"),
        default2: freshDefault(2, "milling_3axis"),
    };
    const dump: Record<string, unknown> = {};
    for (const [name, design] of Object.entries(designs)) {
        const before = JSON.stringify(design);
        let gcode = "";
        try {
            gcode = (await buildMillCncGcode({ design })).gcode; // web Mill export == MCP generate_cnc_gcode
            check(
                `G5 ${name} pocket fit (#368 envelope, default placement)`,
                "built",
                "buildMillCncGcode succeeds",
                true,
            );
        } catch (e) {
            check(
                `G5 ${name} pocket fit (#368 envelope, default placement)`,
                String(e),
                "buildMillCncGcode succeeds",
                false,
            );
            continue;
        }
        check(
            `G5 ${name} design not mutated`,
            JSON.stringify(design) === before,
            "true",
            JSON.stringify(design) === before,
        );
        const prodParts = await workpiecesFromDesign(design, ["left", "right"], cloneProfile(IDAHO_PROFILE));
        const fixParts = await workpiecesFromDesign(
            design,
            ["left", "right"],
            cloneProfile(IDAHO_PROFILE),
            fixtureLoader,
        );
        const d: Record<string, unknown> = { gcodeSha: sha(gcode) };
        if (DUMP) writeFileSync(resolve(DUMP, `${name}.gcode`), gcode);
        for (const side of ["left", "right"] as Side[]) {
            const fb = footBands(gcode, side);
            d[side] = { bands: fb };
            const prod = prodParts.find((p) => p.side === side)!;
            const fix = fixParts.find((p) => p.side === side)!;
            (d[side] as Record<string, unknown>).prodHm = hmBands(prod);
            (d[side] as Record<string, unknown>).fixHm = hmBands(fix);
            if (DUMP) continue;
            const tag = `${name} ${side}`;
            check(
                `G0 ${tag} heel at X0 (heel median > toe median)`,
                fb.heelMedian - fb.toeMedian,
                "> 0",
                fb.heelMedian > fb.toeMedian,
            );
            if (name === "peavy4" || name === "default4") {
                check(
                    `G1/G2 ${tag} toe 70-100% median mm`,
                    +fb.toeMedian.toFixed(3),
                    "4.0..4.4",
                    fb.toeMedian >= 4.0 && fb.toeMedian <= 4.4,
                );
                check(
                    `G1/G2 ${tag} ball 60-70% median mm`,
                    +fb.ballMedian.toFixed(3),
                    ">= 4.0",
                    fb.ballMedian >= 4.0,
                );
                check(
                    `G1/G2 ${tag} forefoot 60-100% min mm`,
                    +fb.foreMin.toFixed(3),
                    ">= 3.8",
                    fb.foreMin >= 3.8,
                );
            } else {
                check(
                    `G3 ${tag} toe 70-100% median mm`,
                    +fb.toeMedian.toFixed(3),
                    "2.0..2.4",
                    fb.toeMedian >= 2.0 && fb.toeMedian <= 2.4,
                );
            }
            // G4a: production loader == test loader, every inside cell.
            let worst = 0;
            const a = prod.heightmap;
            const b = fix.heightmap;
            const sameGrid =
                a.nx === b.nx &&
                a.ny === b.ny &&
                Math.abs(a.originX - b.originX) < 1e-6 &&
                Math.abs(a.originY - b.originY) < 1e-6;
            if (sameGrid) {
                for (let i = 0; i < a.z.length; i++) {
                    if (a.inside[i] !== 1 || b.inside[i] !== 1) continue;
                    const dz = Math.abs(a.z[i]! - b.z[i]!);
                    if (Number.isFinite(dz)) worst = Math.max(worst, dz);
                }
            }
            check(
                `G4a ${tag} production-loader vs test-loader heightmap max |dz| mm`,
                sameGrid ? +worst.toFixed(4) : "grid differs",
                "<= 0.05, same grid",
                sameGrid && worst <= 0.05,
            );
            // G4b: vs frozen main. Must equal main's test-loader top, and sit +2.00 mm over main's production top where main was not clamped.
            const ref = REF[name][side];
            const cand = hmBands(prod);
            let worstFix = 0;
            let worstOff = 0;
            for (let k = 0; k < 10; k++) {
                for (const q of ["p10", "p50", "p90", "max"] as const) {
                    worstFix = Math.max(worstFix, Math.abs(cand[k]![q] - ref.fixHm[k][q]));
                    if (ref.prodHm[k][q] > 1.05)
                        worstOff = Math.max(worstOff, Math.abs(cand[k]![q] - ref.prodHm[k][q] - 2.0));
                }
            }
            check(
                `G4b ${tag} vs main test-loader top (band p10/p50/p90/max) max |dz| mm`,
                +worstFix.toFixed(4),
                "<= 0.05",
                worstFix <= 0.05,
            );
            check(
                `G4c ${tag} offset over main production top = 2.00 mm, max |dz-2| mm`,
                +worstOff.toFixed(4),
                "<= 0.05",
                worstOff <= 0.05,
            );
        }
        dump[name] = d;
        if (!DUMP && name === "default4") {
            // G7: toolpath identical to main except Z (and the hash/time header lines). Run on default4 only:
            // main never hits the 1 mm skin clamp there (forefoot min 2.00 mm), so the only legal change is +2.000 mm in Z.
            // On default2/peavy main was clamped flat at 1 mm, so the spiral legitimately gains points there; G4a-c cover those.
            const mainText = readFileSync(resolve(REF_DIR, `${name}.gcode`), "utf8");
            const A = mainText.split("\n");
            const B = gcode.split("\n");
            let nonZ = 0;
            let perimZ = 0;
            let surfBad = 0;
            let sec = "";
            if (A.length === B.length) {
                for (let i = 0; i < A.length; i++) {
                    const la = A[i]!;
                    const lb = B[i]!;
                    if (la.startsWith("; design-hash") || la.startsWith("; est-time")) continue;
                    if (la.startsWith(";")) sec = la;
                    if (stripZ(la) !== stripZ(lb)) nonZ++;
                    const za = /Z(-?[\d.]+)/.exec(la);
                    const zb = /Z(-?[\d.]+)/.exec(lb);
                    if (!za || !zb) continue;
                    const va = Number(za[1]);
                    const vb = Number(zb[1]);
                    if (sec.startsWith("; perimeter")) {
                        if (va !== vb) perimZ++;
                    } else if (sec.startsWith("; surface") && la.startsWith("G1") && va > 1.0005 && va < 29) {
                        if (Math.abs(vb - va - 2) > 0.002) surfBad++;
                    }
                }
            }
            check(`G7 ${name} line count`, `${B.length} vs main ${A.length}`, "equal", A.length === B.length);
            check(`G7 ${name} lines differing outside Z`, nonZ, "0", A.length === B.length && nonZ === 0);
            check(`G7 ${name} perimeter Z moves changed`, perimZ, "0", A.length === B.length && perimZ === 0);
            check(
                `G7 ${name} unclamped surface Z not +2.000+-0.002`,
                surfBad,
                "0",
                A.length === B.length && surfBad === 0,
            );
        }
    }

    // G6: the shared loader and the 3D-print path are unchanged.
    const base = getDesignBase(designs.default4!, "left")!;
    const shared = await loadBaseGeometry(base);
    const pos = shared!.getAttribute("position").array as Float32Array;
    const sharedSha = sha(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength));
    const printShas: Record<string, string> = {};
    const printDesigns: Record<string, DesignState> = {
        print4: freshDefault(4, "printing_solid"),
        print2: freshDefault(2, "printing_solid"),
    };
    const ab = publicBytes.buffer.slice(
        publicBytes.byteOffset,
        publicBytes.byteOffset + publicBytes.byteLength,
    );
    for (const [name, design] of Object.entries(printDesigns)) {
        for (const side of ["left", "right"] as Side[]) {
            resetSampleTopGeometryCache();
            resetManufacturingSolidCache();
            useBottomPatternStore.getState().clear();
            const foot = await buildFinalizedFootFromSavedDesign({
                design,
                side,
                sampleTopBytes: ab as ArrayBuffer,
            });
            printShas[`${name} ${side}`] = sha(new Uint8Array(foot.stl));
        }
    }
    if (DUMP) {
        if (!existsSync(DUMP)) mkdirSync(DUMP, { recursive: true });
        writeFileSync(
            resolve(DUMP, "main-ref.json"),
            JSON.stringify({ ...dump, sharedLoaderSha: sharedSha, printShas }, null, 1),
        );
        return;
    }
    check(
        "G6 shared loadBaseGeometry(SAMPLE_Top) positions sha",
        sharedSha,
        REF.sharedLoaderSha,
        sharedSha === REF.sharedLoaderSha,
    );
    for (const [k, v] of Object.entries(printShas)) {
        check(`G6 3D-print STL sha ${k}`, v, REF.printShas[k], v === REF.printShas[k]);
    }
    const report = resolve(process.env.CNC_GATE_REPORT ?? "cnc-thickness-gates.json");
    writeFileSync(report, JSON.stringify(results, null, 1));
    const failed = results.filter((r) => !r.pass);
    console.log(`CNC thickness gates: ${results.length - failed.length}/${results.length} PASS`);
    expect(failed).toEqual([]);
}, 1_800_000);
