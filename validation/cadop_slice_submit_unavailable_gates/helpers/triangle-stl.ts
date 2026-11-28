// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Buffer } from "node:buffer";

export function triangleStl(verts: number[]): Uint8Array {
    const buf = Buffer.alloc(84 + 50);
    buf.writeUInt32LE(1, 80);
    for (let i = 0; i < 9; i++) buf.writeFloatLE(verts[i] ?? 0, 84 + 12 + i * 4);
    return new Uint8Array(buf);
}
