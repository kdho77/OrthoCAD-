import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { BufferAttribute, BufferGeometry } from "three";

/** Grading base. Gates compare product bytes and STL output to this commit. */
export const BASE_SHA = "9dd3542900fc6c127a4c5ce205c649071cad8690";

/** Candidate under grade. Recorded for the results table; gates do not branch on it. */
export const CANDIDATE_SHA = "bff60d64dcbb94a9ed6727f95d5248bd4f0b2028";

export const ENGRAVE_NAME_A = "GATE SAMPLE";
export const ENGRAVE_NAME_B = "OTHER NAME";

/** Second manifold pass on an already engraved sole is ~12.8 s. A reuse must stay under this. */
export const WARM_REUSE_MAX_MS = 500;

/** Full warm STL, including the watertight close (~1.1 s on the worker's measurement). */
export const WARM_STL_MAX_MS = 8_000;

/** Vertex positions must match main with no tolerance. */
export const MAX_VERTEX_DELTA_MM = 0;

export interface GateRecord {
    id: string;
    rule: string;
    expectOnBase: "pass" | "fail";
    pass: boolean;
    measured: string;
    threshold: string;
    detail?: string;
}

export function record(row: GateRecord): void {
    const path = process.env.GATE_RESULTS;
    if (!path) return;
    appendFileSync(path, `${JSON.stringify(row)}\n`);
}

export function check(row: GateRecord): void {
    record(row);
    if (!row.pass) {
        const detail = row.detail ? ` ${row.detail}` : "";
        throw new Error(`${row.id} FAIL measured=${row.measured} threshold=${row.threshold}${detail}`);
    }
}

export function sha256(buf: ArrayBuffer | Buffer | string): string {
    const data = typeof buf === "string" ? buf : Buffer.from(buf);
    return createHash("sha256").update(data).digest("hex");
}

export function triangleCount(stl: ArrayBuffer): number {
    return (stl.byteLength - 84) / 50;
}

export function git(args: string[]): string {
    return execFileSync("git", args, {
        encoding: "utf8",
        cwd: process.cwd(),
        maxBuffer: 64 * 1024 * 1024,
    });
}

export function blobAt(rev: string, path: string): string {
    return git(["rev-parse", `${rev}:${path}`]).trim();
}

export function worktreeBlob(path: string): string {
    return git(["hash-object", path]).trim();
}

/**
 * Branch point of HEAD and the grading base.
 * On BASE this is BASE. On the candidate it is the worker's branch point,
 * so a committed diff is the worker's patch and not main commits that
 * landed after the branch and are absent from the candidate tree.
 */
export function gradingMergeBase(): string {
    return git(["merge-base", BASE_SHA, "HEAD"]).trim();
}

/** Product paths in the worker patch, plus unstaged edits. Validation files are omitted. */
export function productDiffNames(): string[] {
    const point = gradingMergeBase();
    const committed = git(["diff", "--name-only", point, "HEAD"]);
    const dirty = git(["diff", "--name-only", "HEAD"]);
    const names = new Set(
        `${committed}\n${dirty}`
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
    );
    return [...names].filter((path) => !path.startsWith("validation/")).sort();
}

export function untrackedProductPaths(): string[] {
    const status = git(["status", "--porcelain", "--untracked-files=all"]);
    const paths: string[] = [];
    for (const line of status.split("\n")) {
        if (!line.startsWith("??")) continue;
        const path = line.slice(3).trim();
        if (!path || path.startsWith("validation/")) continue;
        paths.push(path);
    }
    return paths.sort();
}

export function addedDiffLines(): string[] {
    const point = gradingMergeBase();
    const committed = git(["diff", "-U0", point, "HEAD", "--", "vertex", "packages", "scripts", ".github"]);
    const dirty = git(["diff", "-U0", "HEAD", "--", "vertex", "packages", "scripts", ".github"]);
    return `${committed}\n${dirty}`
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

export function triangleGeometry(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    return geo;
}

export function maxOrderedVertexDeltaMm(a: ArrayBuffer, b: ArrayBuffer): number {
    if (a.byteLength < 84 || b.byteLength < 84) return Number.POSITIVE_INFINITY;
    const viewA = new DataView(a);
    const viewB = new DataView(b);
    const trisA = viewA.getUint32(80, true);
    const trisB = viewB.getUint32(80, true);
    if (trisA !== trisB) return Number.POSITIVE_INFINITY;
    let max = 0;
    let offset = 84;
    for (let t = 0; t < trisA; t++) {
        offset += 12;
        for (let k = 0; k < 9; k++) {
            const da = viewA.getFloat32(offset, true);
            const db = viewB.getFloat32(offset, true);
            max = Math.max(max, Math.abs(da - db));
            offset += 4;
        }
        offset += 2;
    }
    return max;
}

/** Exact coordinate multiset. Identical floats match; any 0 mm drift does not. */
export function vertexMultisetsMatch(a: ArrayBuffer, b: ArrayBuffer): boolean {
    const keys = (buf: ArrayBuffer): string[] | null => {
        if (buf.byteLength < 84) return null;
        const view = new DataView(buf);
        const tris = view.getUint32(80, true);
        if (84 + tris * 50 > buf.byteLength) return null;
        const out: string[] = [];
        let offset = 84;
        for (let t = 0; t < tris; t++) {
            offset += 12;
            for (let v = 0; v < 3; v++) {
                const x = view.getFloat32(offset, true);
                const y = view.getFloat32(offset + 4, true);
                const z = view.getFloat32(offset + 8, true);
                offset += 12;
                out.push(`${x},${y},${z}`);
            }
            offset += 2;
        }
        out.sort();
        return out;
    };
    const ka = keys(a);
    const kb = keys(b);
    if (!ka || !kb || ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
    return true;
}
