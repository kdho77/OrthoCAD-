// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VERTEXSLICE_MAX_UPLOAD_BYTES } from "../../../shared/vertexslice/contract";

export const ACCEPTED_EXTENSIONS = [".stl", ".3mf"] as const;
export const LENGTH_WARN_MIN_MM = 150;
export const LENGTH_WARN_MAX_MM = 350;
export const INCH_SCALE = 25.4;

export type FootSideTag = "left" | "right";

export interface MeshBounds {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    /** Longest AABB edge, treated as insole length (mm). */
    lengthMm: number;
    widthMm: number;
    heightMm: number;
}

export interface ParsedSlicerMesh {
    positions: Float32Array;
    triangleCount: number;
    bounds: MeshBounds;
    closed: boolean;
    extension: ".stl" | ".3mf";
}

export interface MeshIssue {
    message: string;
    fix: string;
}

function boundsFromPositions(positions: Float32Array): MeshBounds {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
    const sorted = [...size].sort((a, b) => b - a);
    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size,
        lengthMm: sorted[0] ?? 0,
        widthMm: sorted[1] ?? 0,
        heightMm: sorted[2] ?? 0,
    };
}

function quantize(v: number): number {
    return Math.round(v * 1000) / 1000;
}

export function isClosedManifold(positions: Float32Array): boolean {
    if (positions.length < 9) return false;
    const edges = new Map<string, number>();
    const vertexKey = (i: number) =>
        `${quantize(positions[i])},${quantize(positions[i + 1])},${quantize(positions[i + 2])}`;
    const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < positions.length; i += 9) {
        const a = vertexKey(i);
        const b = vertexKey(i + 3);
        const c = vertexKey(i + 6);
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            if (u === v) return false;
            edges.set(edgeKey(u, v), (edges.get(edgeKey(u, v)) ?? 0) + 1);
        }
    }
    for (const count of edges.values()) {
        if (count !== 2) return false;
    }
    return edges.size > 0;
}

function parseBinaryStl(buffer: ArrayBuffer): Float32Array {
    const view = new DataView(buffer);
    const count = view.getUint32(80, true);
    const expected = 84 + count * 50;
    if (count <= 0 || expected > buffer.byteLength + 1) {
        throw new Error("binary-stl");
    }
    const positions = new Float32Array(count * 9);
    let o = 0;
    for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) {
            positions[o++] = view.getFloat32(base + k * 4, true);
        }
    }
    return positions;
}

function parseAsciiStl(text: string): Float32Array {
    const verts: number[] = [];
    const re = /vertex\s+([-+eE.\d]+)\s+([-+eE.\d]+)\s+([-+eE.\d]+)/g;
    let match = re.exec(text);
    while (match) {
        verts.push(Number(match[1]), Number(match[2]), Number(match[3]));
        match = re.exec(text);
    }
    if (verts.length < 9 || verts.length % 9 !== 0) {
        throw new Error("ascii-stl");
    }
    return Float32Array.from(verts);
}

export function parseStl(buffer: ArrayBuffer): Float32Array {
    if (buffer.byteLength < 84) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
        if (/solid/i.test(text) && /vertex/i.test(text)) return parseAsciiStl(text);
        throw new Error("too-short");
    }
    const head = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 5));
    const count = new DataView(buffer).getUint32(80, true);
    const expected = 84 + count * 50;
    const looksBinary = expected === buffer.byteLength || Math.abs(expected - buffer.byteLength) <= 1;
    if (looksBinary && count > 0) return parseBinaryStl(buffer);
    if (/^solid/i.test(head) || expected !== buffer.byteLength) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
        if (/facet\s+normal/i.test(text) || /vertex\s+/i.test(text)) return parseAsciiStl(text);
    }
    if (count > 0 && buffer.byteLength >= 84 + 50) return parseBinaryStl(buffer);
    throw new Error("unreadable-stl");
}

interface ZipEntry {
    name: string;
    data: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === "undefined") {
        throw new Error("deflate-unsupported");
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}

export async function readZipEntries(buffer: ArrayBuffer): Promise<ZipEntry[]> {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const entries: ZipEntry[] = [];
    let offset = 0;
    while (offset + 30 <= bytes.byteLength) {
        const sig = view.getUint32(offset, true);
        if (sig !== 0x04034b50) break;
        const method = view.getUint16(offset + 8, true);
        const compSize = view.getUint32(offset + 18, true);
        const nameLen = view.getUint16(offset + 26, true);
        const extraLen = view.getUint16(offset + 28, true);
        const nameStart = offset + 30;
        const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
        const dataStart = nameStart + nameLen + extraLen;
        const dataEnd = dataStart + compSize;
        if (dataEnd > bytes.byteLength) break;
        const payload = bytes.subarray(dataStart, dataEnd);
        let data: Uint8Array;
        if (method === 0) {
            data = payload;
        } else if (method === 8) {
            data = await inflateRaw(payload);
        } else {
            throw new Error("zip-method");
        }
        entries.push({ name, data });
        offset = dataEnd;
    }
    return entries;
}

function parse3mfModel(xml: string): Float32Array {
    const vertices: number[] = [];
    const vertexRe =
        /<vertex\b[^>]*\bx=["']([^"']+)["'][^>]*\by=["']([^"']+)["'][^>]*\bz=["']([^"']+)["'][^>]*\/?>/gi;
    let vm = vertexRe.exec(xml);
    while (vm) {
        vertices.push(Number(vm[1]), Number(vm[2]), Number(vm[3]));
        vm = vertexRe.exec(xml);
    }
    if (vertices.length < 9) throw new Error("3mf-vertices");
    const positions: number[] = [];
    const triRe =
        /<triangle\b[^>]*\bv1=["'](\d+)["'][^>]*\bv2=["'](\d+)["'][^>]*\bv3=["'](\d+)["'][^>]*\/?>/gi;
    let tm = triRe.exec(xml);
    while (tm) {
        const i1 = Number(tm[1]) * 3;
        const i2 = Number(tm[2]) * 3;
        const i3 = Number(tm[3]) * 3;
        positions.push(
            vertices[i1],
            vertices[i1 + 1],
            vertices[i1 + 2],
            vertices[i2],
            vertices[i2 + 1],
            vertices[i2 + 2],
            vertices[i3],
            vertices[i3 + 1],
            vertices[i3 + 2],
        );
        tm = triRe.exec(xml);
    }
    if (positions.length < 9) throw new Error("3mf-triangles");
    return Float32Array.from(positions);
}

export async function parse3mf(buffer: ArrayBuffer): Promise<Float32Array> {
    const entries = await readZipEntries(buffer);
    const model = entries.find((e) => /3dmodel\.model$/i.test(e.name) || /3d\/.*\.model$/i.test(e.name));
    if (!model) throw new Error("3mf-missing-model");
    const xml = new TextDecoder().decode(model.data);
    return parse3mfModel(xml);
}

export function extensionOf(name: string): ".stl" | ".3mf" | null {
    const lower = name.toLowerCase();
    if (lower.endsWith(".stl")) return ".stl";
    if (lower.endsWith(".3mf")) return ".3mf";
    return null;
}

export function validateSlicerFileMeta(file: { name: string; size: number }): MeshIssue | null {
    if (!extensionOf(file.name)) {
        return {
            message: "This file type isn't supported.",
            fix: "Upload an .stl or .3mf file.",
        };
    }
    if (file.size > VERTEXSLICE_MAX_UPLOAD_BYTES) {
        return {
            message: "This file is larger than 50 MB.",
            fix: "Export a smaller STL from OrthoCAD (Export > STL).",
        };
    }
    if (file.size < 16) {
        return {
            message: "This file is empty or too small to be a mesh.",
            fix: "Re-export from OrthoCAD with Export > STL.",
        };
    }
    return null;
}

export async function parseSlicerMesh(
    file: { name: string; size: number },
    buffer: ArrayBuffer,
): Promise<ParsedSlicerMesh> {
    const ext = extensionOf(file.name);
    if (!ext) {
        throw Object.assign(new Error("extension"), {
            issue: validateSlicerFileMeta(file),
        });
    }
    let positions: Float32Array;
    try {
        positions = ext === ".3mf" ? await parse3mf(buffer) : parseStl(buffer);
    } catch {
        const err = new Error("parse");
        (err as Error & { issue: MeshIssue }).issue = {
            message: "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
            fix: "Export a watertight STL and try again.",
        };
        throw err;
    }
    if (positions.length < 9 || positions.length % 9 !== 0) {
        const err = new Error("empty");
        (err as Error & { issue: MeshIssue }).issue = {
            message: "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
            fix: "Export a watertight STL and try again.",
        };
        throw err;
    }
    return {
        positions,
        triangleCount: positions.length / 9,
        bounds: boundsFromPositions(positions),
        closed: isClosedManifold(positions),
        extension: ext,
    };
}

export function scalePositions(positions: Float32Array, scale: number): Float32Array {
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i++) out[i] = positions[i] * scale;
    return out;
}

export function scaledMesh(mesh: ParsedSlicerMesh, scale: number): ParsedSlicerMesh {
    const positions = scalePositions(mesh.positions, scale);
    return {
        ...mesh,
        positions,
        bounds: boundsFromPositions(positions),
    };
}

export function unitsWarning(lengthMm: number): "small" | "large" | null {
    if (lengthMm < LENGTH_WARN_MIN_MM) return "small";
    if (lengthMm > LENGTH_WARN_MAX_MM) return "large";
    return null;
}

export function formatDimensionsMm(bounds: MeshBounds): string {
    const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
    return `${fmt(bounds.lengthMm)} × ${fmt(bounds.widthMm)} × ${fmt(bounds.heightMm)} mm`;
}

/** Tiny closed triangular bipyramid used by tests — not committed as a fixture file. */
export function makeBoxStl(dx: number, dy: number, dz: number): ArrayBuffer {
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
    const faces: [number, number, number][] = [
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
    const count = faces.length;
    const buffer = new ArrayBuffer(84 + count * 50);
    const view = new DataView(buffer);
    view.setUint32(80, count, true);
    let offset = 84;
    for (const [ia, ib, ic] of faces) {
        const a = v[ia];
        const b = v[ib];
        const c = v[ic];
        offset += 12;
        for (const p of [a, b, c]) {
            view.setFloat32(offset, p[0], true);
            view.setFloat32(offset + 4, p[1], true);
            view.setFloat32(offset + 8, p[2], true);
            offset += 12;
        }
        offset += 2;
    }
    return buffer;
}
