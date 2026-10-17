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
    weldToleranceMm,
    WELD_RELATIVE_TOLERANCE,
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

    test("one or two leftover edges warn but do not block; three edges block", () => {
        const closed = {
            boundaryEdges: 0,
            nonManifoldEdges: 0,
            weldedVertexCount: 8,
            triangleCount: 12,
        };
        expect(meshOpenBoundaryIssue(closed)).toBe(null);
        expect(meshOpenBoundaryIssue({ ...closed, boundaryEdges: 1 })).toBe(null);
        expect(meshOpenBoundaryIssue({ ...closed, boundaryEdges: 2 })).toBe(null);
        expect(meshOpenBoundaryIssue({ ...closed, boundaryEdges: 3 })?.message).toMatch(/closed mesh/i);
        expect(meshTopologyWarning({ ...closed, boundaryEdges: 2 })).toMatch(/unmatched edges/i);
        expect(
            meshTopologyWarning({ ...closed, nonManifoldEdges: 3, triangleCount: 13 }),
        ).toMatch(/non-manifold/i);
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
        expect(meshTopologyWarning(topology)).toMatch(/non-manifold/i);
        expect(isClosedManifold(extra)).toBe(true);
    });
});
