// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Flat sole on Z = 0, thick heel at min X, 4 mm toe at max X. Test mesh only. */
export function taperedInsole(
    map: (x: number, y: number, z: number) => [number, number, number],
): Float32Array {
    const nx = 40;
    const ny = 8;
    const length = 200;
    const halfW = 40;
    const topAt = (x: number) => 12 - (8 * x) / length;
    const verts: number[] = [];
    const push = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
        verts.push(...map(...a), ...map(...b), ...map(...c));
    };
    const at = (i: number, j: number, top: boolean): [number, number, number] => {
        const x = (length * i) / nx;
        const y = -halfW + (2 * halfW * j) / ny;
        return [x, y, top ? topAt(x) : 0];
    };
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const a = at(i, j, false);
            const b = at(i + 1, j, false);
            const c = at(i + 1, j + 1, false);
            const d = at(i, j + 1, false);
            push(a, c, b);
            push(a, d, c);
            const ta = at(i, j, true);
            const tb = at(i + 1, j, true);
            const tc = at(i + 1, j + 1, true);
            const td = at(i, j + 1, true);
            push(ta, tb, tc);
            push(ta, tc, td);
        }
    }
    for (let i = 0; i < nx; i++) {
        for (const j of [0, ny]) {
            const a = at(i, j, false);
            const b = at(i + 1, j, false);
            const ta = at(i, j, true);
            const tb = at(i + 1, j, true);
            if (j === 0) {
                push(a, b, tb);
                push(a, tb, ta);
            } else {
                push(a, ta, tb);
                push(a, tb, b);
            }
        }
    }
    for (let j = 0; j < ny; j++) {
        for (const i of [0, nx]) {
            const a = at(i, j, false);
            const b = at(i, j + 1, false);
            const ta = at(i, j, true);
            const tb = at(i, j + 1, true);
            if (i === 0) {
                push(a, ta, tb);
                push(a, tb, b);
            } else {
                push(a, b, tb);
                push(a, tb, ta);
            }
        }
    }
    return Float32Array.from(verts);
}

export function stlBytes(positions: Float32Array): ArrayBuffer {
    const count = positions.length / 9;
    const buffer = new ArrayBuffer(84 + count * 50);
    const view = new DataView(buffer);
    view.setUint32(80, count, true);
    let offset = 84;
    for (let i = 0; i < positions.length; i++) {
        if (i % 9 === 0) offset += 12;
        view.setFloat32(offset, positions[i] ?? 0, true);
        offset += 4;
        if (i % 9 === 8) offset += 2;
    }
    return buffer;
}

export function taperedInsoleStl(): Uint8Array {
    return new Uint8Array(stlBytes(taperedInsole((x, y, z) => [x, y, z])));
}
