// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    analyzeMeshTopology,
    INCH_SCALE,
    INSOLE_DEMO_MM,
    isClosedManifold,
    makeBoxStl,
    makeInsoleDemoMesh,
    meshOpenBoundaryIssue,
    meshTopologyWarning,
    parseSlicerMesh,
    parseStl,
    scaledMesh,
    unitsWarning,
    validateSlicerFileMeta,
    WELD_RELATIVE_TOLERANCE,
    weldToleranceMm,
} from "./slicer-mesh";

/** Kendon's OrthoCAD export size: Extrusion_FlattenHeel_HolePattern_Left (2).stl */
const INSOLE_MM: [number, number, number] = INSOLE_DEMO_MM;

function encodeBinaryStl(positions: Float32Array): ArrayBuffer {
    const count = positions.length / 9;
    const buffer = new ArrayBuffer(84 + count * 50);
    const view = new DataView(buffer);
    view.setUint32(80, count, true);
    let offset = 84;
    for (let t = 0; t < count; t++) {
        offset += 12;
        for (let k = 0; k < 9; k++) {
            view.setFloat32(offset, positions[t * 9 + k], true);
            offset += 4;
        }
        offset += 2;
    }
    return buffer;
}

function encodeAsciiStl(positions: Float32Array, name = "insole"): ArrayBuffer {
    const lines = [`solid ${name}`];
    for (let i = 0; i < positions.length; i += 9) {
        lines.push("  facet normal 0 0 0", "    outer loop");
        for (let k = 0; k < 3; k++) {
            const o = i + k * 3;
            lines.push(`      vertex ${positions[o]} ${positions[o + 1]} ${positions[o + 2]}`);
        }
        lines.push("    endloop", "  endfacet");
    }
    lines.push(`endsolid ${name}`, "");
    return new TextEncoder().encode(lines.join("\n")).buffer;
}

function jitterPositions(positions: Float32Array, amplitudeMm: number): Float32Array {
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i++) {
        const noise = ((i * 17) % 11) * (amplitudeMm / 10);
        out[i] = positions[i] + noise;
    }
    return out;
}

function lerp3(a: number[], b: number[], t: number): number[] {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function bilinear(
    p00: number[],
    p10: number[],
    p11: number[],
    p01: number[],
    u: number,
    v: number,
): number[] {
    return lerp3(lerp3(p00, p10, u), lerp3(p01, p11, u), v);
}

function makeSubdividedBoxPositions(dx: number, dy: number, dz: number, divisions: number): Float32Array {
    const hx = dx / 2;
    const hy = dy / 2;
    const hz = dz / 2;
    const faces: [number[], number[], number[], number[]][] = [
        [
            [-hx, -hy, -hz],
            [hx, -hy, -hz],
            [hx, hy, -hz],
            [-hx, hy, -hz],
        ],
        [
            [-hx, -hy, hz],
            [-hx, hy, hz],
            [hx, hy, hz],
            [hx, -hy, hz],
        ],
        [
            [-hx, -hy, -hz],
            [-hx, -hy, hz],
            [hx, -hy, hz],
            [hx, -hy, -hz],
        ],
        [
            [-hx, hy, -hz],
            [hx, hy, -hz],
            [hx, hy, hz],
            [-hx, hy, hz],
        ],
        [
            [-hx, -hy, -hz],
            [-hx, hy, -hz],
            [-hx, hy, hz],
            [-hx, -hy, hz],
        ],
        [
            [hx, -hy, -hz],
            [hx, -hy, hz],
            [hx, hy, hz],
            [hx, hy, -hz],
        ],
    ];
    const tris: number[] = [];
    for (const [p00, p10, p11, p01] of faces) {
        for (let i = 0; i < divisions; i++) {
            for (let j = 0; j < divisions; j++) {
                const u0 = i / divisions;
                const u1 = (i + 1) / divisions;
                const v0 = j / divisions;
                const v1 = (j + 1) / divisions;
                const a = bilinear(p00, p10, p11, p01, u0, v0);
                const b = bilinear(p00, p10, p11, p01, u1, v0);
                const c = bilinear(p00, p10, p11, p01, u1, v1);
                const d = bilinear(p00, p10, p11, p01, u0, v1);
                tris.push(...a, ...b, ...c, ...a, ...c, ...d);
            }
        }
    }
    return Float32Array.from(tris);
}

function storeZip(files: { name: string; data: Uint8Array }[]): ArrayBuffer {
    const chunks: Uint8Array[] = [];
    for (const file of files) {
        const name = new TextEncoder().encode(file.name);
        const header = new Uint8Array(30 + name.length);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint32(18, file.data.length, true);
        view.setUint32(22, file.data.length, true);
        view.setUint16(26, name.length, true);
        header.set(name, 30);
        chunks.push(header, file.data);
    }
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out.buffer;
}

function boxObjectXml(id: string, name: string, dx: number, dy: number, dz: number): string {
    const hx = dx / 2;
    const hy = dy / 2;
    const hz = dz / 2;
    const v = [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, hy, -hz],
        [-hx, hy, -hz],
        [-hx, -hy, hz],
        [hx, -hy, hz],
        [hx, hy, hz],
        [-hx, hy, hz],
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
    const vertices = v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("");
    const triangles = faces.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("");
    return `<object id="${id}" name="${name}" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
}

function threeMf(objects: string, items: string): ArrayBuffer {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objects}</resources><build>${items}</build></model>`;
    return storeZip([{ name: "3D/3dmodel.model", data: new TextEncoder().encode(xml) }]);
}

describe("slicer mesh", () => {
    test("known box STL has mm dimensions within 0.5 mm", async () => {
        const buffer = makeBoxStl(270, 90, 15);
        const mesh = await parseSlicerMesh({ name: "insole.stl", size: buffer.byteLength }, buffer);
        expect(mesh.bounds.lengthMm).toBeGreaterThan(269.5);
        expect(mesh.bounds.lengthMm).toBeLessThan(270.5);
        expect(mesh.bounds.widthMm).toBeGreaterThan(89.5);
        expect(mesh.bounds.widthMm).toBeLessThan(90.5);
        expect(mesh.bounds.heightMm).toBeGreaterThan(14.5);
        expect(mesh.bounds.heightMm).toBeLessThan(15.5);
        expect(mesh.closed).toBe(true);
        expect(mesh.topology.boundaryEdges).toBe(0);
        expect(meshOpenBoundaryIssue(mesh.topology)).toBe(null);
    });

    test("inch-sized file warns and Treat as inches rescales", async () => {
        const buffer = makeBoxStl(10.5, 3.5, 0.6);
        const mesh = await parseSlicerMesh({ name: "inch.stl", size: buffer.byteLength }, buffer);
        expect(unitsWarning(mesh.bounds.lengthMm)).toBe("small");
        const scaled = scaledMesh(mesh, INCH_SCALE);
        expect(scaled.bounds.lengthMm).toBeGreaterThan(10.5 * INCH_SCALE - 0.5);
        expect(scaled.bounds.lengthMm).toBeLessThan(10.5 * INCH_SCALE + 0.5);
        expect(unitsWarning(scaled.bounds.lengthMm)).toBe(null);
    });

    test("corrupt bytes and a single triangle fail closed-mesh checks", () => {
        expect(validateSlicerFileMeta({ name: "nope.txt", size: 100 })?.message).toMatch(/supported/i);
        expect(() => parseStl(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow();
        const open = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        expect(isClosedManifold(open)).toBe(false);
        expect(meshOpenBoundaryIssue(analyzeMeshTopology(open))?.message).toMatch(/closed mesh/i);
    });

    test("watertight binary and ASCII STL of insole size pass after welding", async () => {
        const [dx, dy, dz] = INSOLE_MM;
        const binary = makeBoxStl(dx, dy, dz);
        const binMesh = await parseSlicerMesh({ name: "insole.stl", size: binary.byteLength }, binary);
        expect(binMesh.closed).toBe(true);
        expect(binMesh.topology.boundaryEdges).toBe(0);
        expect(binMesh.topology.nonManifoldEdges).toBe(0);
        expect(meshOpenBoundaryIssue(binMesh.topology)).toBe(null);
        expect(binMesh.warning).toBe(null);
        expect(binMesh.bounds.lengthMm).toBeGreaterThan(184.6);
        expect(binMesh.bounds.lengthMm).toBeLessThan(185.6);

        const ascii = encodeAsciiStl(parseStl(binary));
        const asciiMesh = await parseSlicerMesh({ name: "insole.stl", size: ascii.byteLength }, ascii);
        expect(asciiMesh.closed).toBe(true);
        expect(asciiMesh.topology.boundaryEdges).toBe(0);
        expect(meshOpenBoundaryIssue(asciiMesh.topology)).toBe(null);
    });

    test("triangle soup with 0.005 mm jitter still welds as closed", () => {
        const positions = jitterPositions(parseStl(makeBoxStl(...INSOLE_MM)), 0.005);
        const topology = analyzeMeshTopology(positions);
        expect(topology.boundaryEdges).toBe(0);
        expect(isClosedManifold(positions)).toBe(true);
        expect(meshOpenBoundaryIssue(topology)).toBe(null);
        const diag = Math.hypot(...INSOLE_MM);
        const bounds = {
            min: [0, 0, 0] as [number, number, number],
            max: INSOLE_MM,
            size: INSOLE_MM,
            lengthMm: 185.1,
            widthMm: 89.7,
            heightMm: 28.7,
        };
        expect(weldToleranceMm(bounds)).toBeCloseTo(diag * WELD_RELATIVE_TOLERANCE, 8);
    });

    test("a mesh with a hole is blocked as an open boundary", async () => {
        const closed = parseStl(makeBoxStl(...INSOLE_MM));
        const hole = closed.subarray(9);
        const buffer = encodeBinaryStl(hole);
        const mesh = await parseSlicerMesh({ name: "open.stl", size: buffer.byteLength }, buffer);
        expect(mesh.closed).toBe(false);
        expect(mesh.topology.boundaryEdges).toBeGreaterThanOrEqual(3);
        expect(meshOpenBoundaryIssue(mesh.topology)?.message).toMatch(/closed mesh/i);
    });

    test("large watertight mesh stays closed", async () => {
        const positions = makeSubdividedBoxPositions(...INSOLE_MM, 24);
        expect(positions.length / 9).toBeGreaterThan(5000);
        const buffer = encodeBinaryStl(positions);
        const mesh = await parseSlicerMesh({ name: "large.stl", size: buffer.byteLength }, buffer);
        expect(mesh.closed).toBe(true);
        expect(mesh.topology.boundaryEdges).toBe(0);
        expect(meshOpenBoundaryIssue(mesh.topology)).toBe(null);
    });

    test("tiny boundary edges warn and do not block; a loop over 2 mm blocks", () => {
        const closed = {
            boundaryEdges: 0,
            nonManifoldEdges: 0,
            weldedVertexCount: 8,
            triangleCount: 12,
            boundaryLoops: 0,
            longestBoundaryPerimeterMm: 0,
        };
        expect(meshOpenBoundaryIssue(closed)).toBe(null);
        expect(meshOpenBoundaryIssue({ ...closed, boundaryEdges: 1 })).toBe(null);
        expect(meshOpenBoundaryIssue({ ...closed, boundaryEdges: 3, longestBoundaryPerimeterMm: 0.04 })).toBe(
            null,
        );
        expect(
            meshTopologyWarning({ ...closed, boundaryEdges: 3, longestBoundaryPerimeterMm: 0.04 }),
        ).toMatch(/Small mesh gaps found/);
        expect(
            meshOpenBoundaryIssue({ ...closed, boundaryLoops: 1, longestBoundaryPerimeterMm: 5 })?.message,
        ).toMatch(/closed mesh/i);
        expect(meshTopologyWarning({ ...closed, nonManifoldEdges: 3, triangleCount: 13 })).toMatch(
            /Small mesh gaps found/,
        );
        expect(meshOpenBoundaryIssue({ ...closed, nonManifoldEdges: 3, triangleCount: 13 })).toBe(null);
    });

    test("demo insole mesh is watertight at OrthoCAD export size", () => {
        const mesh = makeInsoleDemoMesh();
        expect(mesh.closed).toBe(true);
        expect(mesh.warning).toBe(null);
        expect(mesh.topology.boundaryEdges).toBe(0);
        expect(mesh.topology.nonManifoldEdges).toBe(0);
        expect(mesh.triangleCount).toBeGreaterThan(100);
        expect(meshOpenBoundaryIssue(mesh.topology)).toBe(null);
        expect(mesh.bounds.lengthMm).toBeGreaterThan(184.6);
        expect(mesh.bounds.lengthMm).toBeLessThan(185.6);
        expect(mesh.bounds.widthMm).toBeGreaterThan(89.2);
        expect(mesh.bounds.widthMm).toBeLessThan(90.2);
        expect(mesh.bounds.heightMm).toBeGreaterThan(28.2);
        expect(mesh.bounds.heightMm).toBeLessThan(29.2);
    });

    test("duplicated triangle is a non-manifold warning, not a block", () => {
        const closed = parseStl(makeBoxStl(...INSOLE_MM));
        const extra = new Float32Array(closed.length + 9);
        extra.set(closed);
        extra.set(closed.subarray(0, 9), closed.length);
        const topology = analyzeMeshTopology(extra);
        expect(topology.boundaryEdges).toBe(0);
        expect(topology.nonManifoldEdges).toBeGreaterThan(0);
        expect(meshOpenBoundaryIssue(topology)).toBe(null);
        expect(meshTopologyWarning(topology)).toMatch(/Small mesh gaps found/);
        expect(isClosedManifold(extra)).toBe(true);
    });

    test("degenerate triangles, duplicate faces, and a sub-0.05 mm crack warn and do not block", () => {
        const base = parseStl(makeBoxStl(...INSOLE_MM));
        const cracked = new Float32Array(base);
        cracked[0] += 0.04;
        const all = new Float32Array(cracked.length + 18);
        all.set(cracked);
        all.set(base.subarray(18, 27), cracked.length);
        const d = cracked.length + 9;
        all[d] = 0;
        all[d + 1] = 0;
        all[d + 2] = 0;
        all[d + 3] = 4;
        all[d + 4] = 0;
        all[d + 5] = 0;
        all[d + 6] = 8;
        all[d + 7] = 0;
        all[d + 8] = 0;
        const topology = analyzeMeshTopology(all);
        expect(meshOpenBoundaryIssue(topology)).toBe(null);
        expect(meshTopologyWarning(topology)).toMatch(/Small mesh gaps found/);
        expect(topology.longestBoundaryPerimeterMm).toBeLessThanOrEqual(2);
    });

    test("a 5 mm hole blocks as an open mesh", () => {
        const base = parseStl(makeBoxStl(...INSOLE_MM));
        let maxZ = -Infinity;
        for (let i = 2; i < base.length; i += 3) maxZ = Math.max(maxZ, base[i]);
        const kept: number[] = [];
        for (let t = 0; t < base.length; t += 9) {
            const onTop = [0, 1, 2].every((k) => Math.abs(base[t + k * 3 + 2] - maxZ) < 1e-3);
            if (onTop) continue;
            for (let k = 0; k < 9; k++) kept.push(base[t + k]);
        }
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let t = 0; t < base.length; t += 9) {
            const onTop = [0, 1, 2].every((k) => Math.abs(base[t + k * 3 + 2] - maxZ) < 1e-3);
            if (!onTop) continue;
            for (let k = 0; k < 3; k++) {
                const x = base[t + k * 3];
                const y = base[t + k * 3 + 1];
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
        const hole = 2.5;
        const z = maxZ;
        const trap = (a: number[], b: number[], c: number[], d: number[]) => {
            kept.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
            kept.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
        };
        const S = (x: number, y: number) => [x, y, z];
        trap(S(minX, minY), S(maxX, minY), S(hole, -hole), S(-hole, -hole));
        trap(S(minX, maxY), S(-hole, hole), S(hole, hole), S(maxX, maxY));
        trap(S(maxX, minY), S(maxX, maxY), S(hole, hole), S(hole, -hole));
        trap(S(minX, minY), S(-hole, -hole), S(-hole, hole), S(minX, maxY));
        const topology = analyzeMeshTopology(Float32Array.from(kept));
        expect(topology.longestBoundaryPerimeterMm).toBeGreaterThan(2);
        expect(meshOpenBoundaryIssue(topology)?.message).toMatch(/closed mesh/i);
    });

    test("a one-foot 3MF keeps a shell and pad assembled in one mesh", async () => {
        const buffer = threeMf(
            boxObjectXml("1", "shell", 250, 80, 20) + boxObjectXml("2", "met pad", 30, 20, 4),
            `<item objectid="1"/><item objectid="2" transform="1 0 0 40 0 1 0 10 0 0 1 22"/>`,
        );
        const mesh = await parseSlicerMesh({ name: "foot.3mf", size: buffer.byteLength }, buffer);
        expect(meshOpenBoundaryIssue(mesh.topology)).toBe(null);
        expect(mesh.triangleCount).toBe(24);
        let sawPad = false;
        for (let i = 0; i < mesh.positions.length; i += 3) {
            if (Math.abs(mesh.positions[i] - 55) < 0.2 && Math.abs(mesh.positions[i + 2] - 24) < 0.2)
                sawPad = true;
        }
        expect(sawPad).toBe(true);
    });

    test("a 3MF with two insole bodies or left and right names is rejected", async () => {
        const sideBySide = threeMf(
            boxObjectXml("1", "shell", 250, 80, 20) + boxObjectXml("2", "other", 250, 80, 20),
            `<item objectid="1"/><item objectid="2" transform="1 0 0 300 0 1 0 0 0 0 1 0"/>`,
        );
        await expect(
            parseSlicerMesh({ name: "pair.3mf", size: sideBySide.byteLength }, sideBySide),
        ).rejects.toMatchObject({ issue: { message: "Upload each foot separately." } });

        const named = threeMf(
            boxObjectXml("1", "Left insole", 40, 20, 8) + boxObjectXml("2", "Right insole", 40, 20, 8),
            `<item objectid="1"/><item objectid="2"/>`,
        );
        await expect(
            parseSlicerMesh({ name: "feet.3mf", size: named.byteLength }, named),
        ).rejects.toMatchObject({ issue: { message: "Upload each foot separately." } });
    });
});
