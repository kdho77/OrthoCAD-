import type { BufferGeometry } from "three";

// Pure-TS binary STL writer. Works on any indexed or non-indexed
// THREE.BufferGeometry with a "position" attribute. Used as the default STL
// exporter until the Chili3D OpenCascade kernel STL writer is wired in.

export function geometryToBinarySTL(geometry: BufferGeometry): ArrayBuffer {
    const position = geometry.getAttribute("position");
    if (!position) {
        throw new Error("Geometry has no position attribute");
    }

    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : position.count / 3;

    const headerBytes = 84; // 80-byte header + 4-byte triangle count
    const triangleBytes = 50; // 12 floats * 4 + 2-byte attribute
    const buffer = new ArrayBuffer(headerBytes + triangleCount * triangleBytes);
    const view = new DataView(buffer);

    view.setUint32(80, triangleCount, true);

    let offset = headerBytes;
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    const c = { x: 0, y: 0, z: 0 };

    const readVertex = (i: number, out: { x: number; y: number; z: number }) => {
        out.x = position.getX(i);
        out.y = position.getY(i);
        out.z = position.getZ(i);
    };

    for (let t = 0; t < triangleCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

        readVertex(i0, a);
        readVertex(i1, b);
        readVertex(i2, c);

        // Face normal via cross product of edges.
        const ux = b.x - a.x;
        const uy = b.y - a.y;
        const uz = b.z - a.z;
        const vx = c.x - a.x;
        const vy = c.y - a.y;
        const vz = c.z - a.z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        view.setFloat32(offset, nx, true);
        view.setFloat32(offset + 4, ny, true);
        view.setFloat32(offset + 8, nz, true);
        offset += 12;

        for (const v of [a, b, c]) {
            view.setFloat32(offset, v.x, true);
            view.setFloat32(offset + 4, v.y, true);
            view.setFloat32(offset + 8, v.z, true);
            offset += 12;
        }

        view.setUint16(offset, 0, true);
        offset += 2;
    }

    return buffer;
}
