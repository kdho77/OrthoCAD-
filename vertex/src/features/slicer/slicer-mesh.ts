// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VERTEXSLICE_MAX_UPLOAD_BYTES } from "../../../shared/vertexslice/contract";
import { analyzeMeshTopology, meshTopologyWarning } from "./slicer-topology";

export type { MeshTopology } from "./slicer-topology";
export {
    analyzeMeshTopology,
    cameraDistanceForBounds,
    isClosedManifold,
    meshOpenBoundaryIssue,
    meshTopologyWarning,
    OPEN_BOUNDARY_BLOCK_EDGES,
    SLICER_VIEW_DIR,
    WELD_RELATIVE_TOLERANCE,
    weldToleranceMm,
    weldVertexIds,
} from "./slicer-topology";

export const ACCEPTED_EXTENSIONS = [".stl", ".3mf"] as const;
export const LENGTH_WARN_MIN_MM = 150;
export const LENGTH_WARN_MAX_MM = 350;
export const INCH_SCALE = 25.4;

export type FootSideTag = "left" | "right";

/** One model, one foot, one G-code. A second file or a two-foot 3MF uses this. */
export const UPLOAD_EACH_FOOT_MESSAGE = "Upload each foot separately.";

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
    topology: MeshTopology;
    /** Non-blocking mesh note; the slicer is the final authority. */
    warning: string | null;
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

interface MeshPart {
    name: string;
    positions: Float32Array;
}

function xmlAttr(tag: string, name: string): string | undefined {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
    return match?.[1];
}

/** 3MF transform is a row-major 3×4 affine matrix. */
function parseTransform(raw: string | undefined): number[] | null {
    if (!raw) return null;
    const values = raw.trim().split(/\s+/).map(Number);
    if (values.length < 12 || values.some((n) => !Number.isFinite(n))) return null;
    return values.slice(0, 12);
}

function multiplyTransform(outer: number[], inner: number[]): number[] {
    const out = new Array<number>(12);
    for (let row = 0; row < 3; row++) {
        const a0 = outer[row * 4];
        const a1 = outer[row * 4 + 1];
        const a2 = outer[row * 4 + 2];
        const a3 = outer[row * 4 + 3];
        out[row * 4] = a0 * inner[0] + a1 * inner[4] + a2 * inner[8];
        out[row * 4 + 1] = a0 * inner[1] + a1 * inner[5] + a2 * inner[9];
        out[row * 4 + 2] = a0 * inner[2] + a1 * inner[6] + a2 * inner[10];
        out[row * 4 + 3] = a0 * inner[3] + a1 * inner[7] + a2 * inner[11] + a3;
    }
    return out;
}

function transformPositions(local: Float32Array, matrix: number[] | null): Float32Array {
    if (!matrix) return local;
    const out = new Float32Array(local.length);
    for (let i = 0; i < local.length; i += 3) {
        const x = local[i];
        const y = local[i + 1];
        const z = local[i + 2];
        out[i] = matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3];
        out[i + 1] = matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7];
        out[i + 2] = matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11];
    }
    return out;
}

function meshFromXmlFragment(xml: string): Float32Array | null {
    const vertices: number[] = [];
    const vertexRe =
        /<vertex\b[^>]*\bx=["']([^"']+)["'][^>]*\by=["']([^"']+)["'][^>]*\bz=["']([^"']+)["'][^>]*\/?>/gi;
    let vm = vertexRe.exec(xml);
    while (vm) {
        vertices.push(Number(vm[1]), Number(vm[2]), Number(vm[3]));
        vm = vertexRe.exec(xml);
    }
    if (vertices.length < 9) return null;
    const positions: number[] = [];
    const triRe =
        /<triangle\b[^>]*\bv1=["'](\d+)["'][^>]*\bv2=["'](\d+)["'][^>]*\bv3=["'](\d+)["'][^>]*\/?>/gi;
    let tm = triRe.exec(xml);
    while (tm) {
        const i1 = Number(tm[1]) * 3;
        const i2 = Number(tm[2]) * 3;
        const i3 = Number(tm[3]) * 3;
        if (i1 + 2 >= vertices.length || i2 + 2 >= vertices.length || i3 + 2 >= vertices.length) {
            tm = triRe.exec(xml);
            continue;
        }
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
    if (positions.length < 9) return null;
    return Float32Array.from(positions);
}

function hasFootWord(text: string, word: "left" | "right"): boolean {
    return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(text);
}

function isInsoleSizedBody(bounds: MeshBounds): boolean {
    return (
        bounds.lengthMm >= 150 &&
        bounds.lengthMm <= 360 &&
        bounds.widthMm >= 50 &&
        bounds.widthMm <= 160 &&
        bounds.heightMm <= 60
    );
}

function centroidOf(positions: Float32Array): [number, number, number] {
    let x = 0;
    let y = 0;
    let z = 0;
    const n = positions.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
        x += positions[i];
        y += positions[i + 1];
        z += positions[i + 2];
    }
    return [x / n, y / n, z / n];
}

/**
 * A 3MF may be a shell plus a pad. It is both feet when two insole-sized
 * bodies sit apart, or when the names say left and right.
 */
export function threeMfHoldsBothFeet(parts: MeshPart[], fileName = ""): boolean {
    const names = [fileName, ...parts.map((part) => part.name)].join(" ");
    if (hasFootWord(names, "left") && hasFootWord(names, "right")) return true;
    const bodies = parts.filter((part) => isInsoleSizedBody(boundsFromPositions(part.positions)));
    for (let i = 0; i < bodies.length; i++) {
        const a = centroidOf(bodies[i].positions);
        for (let j = i + 1; j < bodies.length; j++) {
            const b = centroidOf(bodies[j].positions);
            if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 60) return true;
        }
    }
    return false;
}

interface Parsed3mf {
    positions: Float32Array;
    bothFeet: boolean;
}

function parse3mfDocument(xml: string, fileName: string): Parsed3mf {
    interface RawObject {
        id: string;
        name: string;
        transform: number[] | null;
        mesh: Float32Array | null;
        components: Array<{ id: string; transform: number[] | null }>;
    }
    const objects = new Map<string, RawObject>();
    const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
    let om = objectRe.exec(xml);
    while (om) {
        const attrs = om[1] ?? "";
        const body = om[2] ?? "";
        const id = xmlAttr(attrs, "id");
        if (id) {
            const components: RawObject["components"] = [];
            const compRe = /<component\b([^>]*)\/?>/gi;
            let cm = compRe.exec(body);
            while (cm) {
                const cid = xmlAttr(cm[1] ?? "", "objectid");
                if (cid)
                    components.push({
                        id: cid,
                        transform: parseTransform(xmlAttr(cm[1] ?? "", "transform")),
                    });
                cm = compRe.exec(body);
            }
            objects.set(id, {
                id,
                name: xmlAttr(attrs, "name") ?? "",
                transform: parseTransform(xmlAttr(attrs, "transform")),
                mesh: meshFromXmlFragment(body),
                components,
            });
        }
        om = objectRe.exec(xml);
    }
    const items: Array<{ id: string; transform: number[] | null }> = [];
    const itemRe = /<item\b([^>]*)\/?>/gi;
    let im = itemRe.exec(xml);
    while (im) {
        const id = xmlAttr(im[1] ?? "", "objectid");
        if (id) items.push({ id, transform: parseTransform(xmlAttr(im[1] ?? "", "transform")) });
        im = itemRe.exec(xml);
    }
    const parts: MeshPart[] = [];
    const emit = (id: string, extra: number[] | null, stack: Set<string>) => {
        if (stack.has(id)) return;
        const obj = objects.get(id);
        if (!obj) return;
        stack.add(id);
        const matrix =
            extra && obj.transform ? multiplyTransform(extra, obj.transform) : (extra ?? obj.transform);
        if (obj.mesh) {
            parts.push({ name: obj.name, positions: transformPositions(obj.mesh, matrix) });
        }
        for (const component of obj.components) {
            const child =
                matrix && component.transform
                    ? multiplyTransform(matrix, component.transform)
                    : (matrix ?? component.transform);
            emit(component.id, child, stack);
        }
        stack.delete(id);
    };
    if (items.length > 0) {
        for (const item of items) emit(item.id, item.transform, new Set());
    } else {
        for (const obj of objects.values()) emit(obj.id, null, new Set());
    }
    if (parts.length === 0) {
        const flat = meshFromXmlFragment(xml);
        if (!flat) throw new Error("3mf-triangles");
        return { positions: flat, bothFeet: false };
    }
    if (threeMfHoldsBothFeet(parts, fileName)) {
        const merged = parts.reduce((n, part) => n + part.positions.length, 0);
        const positions = new Float32Array(merged);
        return { positions, bothFeet: true };
    }
    const merged = new Float32Array(parts.reduce((n, part) => n + part.positions.length, 0));
    let offset = 0;
    for (const part of parts) {
        merged.set(part.positions, offset);
        offset += part.positions.length;
    }
    return { positions: merged, bothFeet: false };
}

export async function parse3mf(buffer: ArrayBuffer, fileName = ""): Promise<Float32Array> {
    const parsed = await parse3mfParts(buffer, fileName);
    if (parsed.bothFeet) {
        const err = new Error("both-feet");
        (err as Error & { issue: MeshIssue }).issue = {
            message: UPLOAD_EACH_FOOT_MESSAGE,
            fix: "This file has both feet.",
        };
        throw err;
    }
    return parsed.positions;
}

async function parse3mfParts(buffer: ArrayBuffer, fileName: string): Promise<Parsed3mf> {
    const entries = await readZipEntries(buffer);
    const model = entries.find((e) => /3dmodel\.model$/i.test(e.name) || /3d\/.*\.model$/i.test(e.name));
    if (!model) throw new Error("3mf-missing-model");
    const xml = new TextDecoder().decode(model.data);
    return parse3mfDocument(xml, fileName);
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
        positions = ext === ".3mf" ? await parse3mf(buffer, file.name) : parseStl(buffer);
    } catch (caught) {
        const existing = (caught as { issue?: MeshIssue }).issue;
        if (existing) throw caught;
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
    const topology = analyzeMeshTopology(positions);
    return {
        positions,
        triangleCount: positions.length / 9,
        bounds: boundsFromPositions(positions),
        closed: topology.triangleCount > 0 && topology.boundaryEdges === 0,
        topology,
        warning: meshTopologyWarning(topology),
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

/** Kendon's OrthoCAD export size used by `/slicer?demo=*` and closed-mesh tests. */
export const INSOLE_DEMO_MM: [number, number, number] = [185.1, 89.7, 28.7];

function pushTri(out: number[], a: number[], b: number[], c: number[]): void {
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * Watertight stadium (capsule) extrusion that reads as an insole in the viewer.
 * Demo used to ship a 2-triangle plane, so the camera framed empty space.
 */
export function makeStadiumInsolePositions(
    lengthMm = INSOLE_DEMO_MM[0],
    widthMm = INSOLE_DEMO_MM[1],
    heightMm = INSOLE_DEMO_MM[2],
    segments = 48,
): Float32Array {
    const halfL = lengthMm / 2;
    const r = widthMm / 2;
    const halfH = heightMm / 2;
    const halfStraight = Math.max(halfL - r, 0);
    const halfN = Math.max(8, Math.floor(segments / 2));
    const ring: Array<[number, number]> = [];
    for (let i = 0; i < halfN; i++) {
        const t = -Math.PI / 2 + (Math.PI * i) / halfN;
        ring.push([halfStraight + r * Math.cos(t), r * Math.sin(t)]);
    }
    for (let i = 0; i < halfN; i++) {
        const t = Math.PI / 2 + (Math.PI * i) / halfN;
        ring.push([-halfStraight + r * Math.cos(t), r * Math.sin(t)]);
    }
    const tris: number[] = [];
    const count = ring.length;
    for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const topA = [ring[i][0], ring[i][1], halfH];
        const topB = [ring[j][0], ring[j][1], halfH];
        const botB = [ring[j][0], ring[j][1], -halfH];
        const botA = [ring[i][0], ring[i][1], -halfH];
        pushTri(tris, topA, topB, botB);
        pushTri(tris, topA, botB, botA);
    }
    const topCenter = [0, 0, halfH];
    const botCenter = [0, 0, -halfH];
    for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        pushTri(tris, topCenter, [ring[i][0], ring[i][1], halfH], [ring[j][0], ring[j][1], halfH]);
        pushTri(tris, botCenter, [ring[j][0], ring[j][1], -halfH], [ring[i][0], ring[i][1], -halfH]);
    }
    return Float32Array.from(tris);
}

export function makeInsoleDemoMesh(
    lengthMm = INSOLE_DEMO_MM[0],
    widthMm = INSOLE_DEMO_MM[1],
    heightMm = INSOLE_DEMO_MM[2],
): ParsedSlicerMesh {
    const positions = makeStadiumInsolePositions(lengthMm, widthMm, heightMm);
    const topology = analyzeMeshTopology(positions);
    return {
        positions,
        triangleCount: positions.length / 9,
        bounds: boundsFromPositions(positions),
        closed: topology.triangleCount > 0 && topology.boundaryEdges === 0,
        topology,
        warning: meshTopologyWarning(topology),
        extension: ".stl",
    };
}
