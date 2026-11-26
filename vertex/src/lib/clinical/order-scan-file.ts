// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// A stored foot-scan file for one order client. Bytes are measured and dropped.
// They are never written into the design and they are never the insole mesh.

export interface OrderScanFile {
    id: string;
    side: "left" | "right";
    fileName: string;
    /** ISO timestamp. Newest wins when one side has more than one file. */
    uploadedAt: string;
    bytes: Uint8Array;
}

/**
 * One file per foot. Newest `uploadedAt` wins. An equal timestamp uses the
 * greater id. This is storage order, not a clinical choice.
 */
export function selectLatestScanPerSide(files: readonly OrderScanFile[]): OrderScanFile[] {
    const chosen = new Map<"left" | "right", OrderScanFile>();
    for (const file of files) {
        const current = chosen.get(file.side);
        if (!current) {
            chosen.set(file.side, file);
            continue;
        }
        if (file.uploadedAt > current.uploadedAt) {
            chosen.set(file.side, file);
            continue;
        }
        if (file.uploadedAt === current.uploadedAt && file.id > current.id) {
            chosen.set(file.side, file);
        }
    }
    const ordered: OrderScanFile[] = [];
    const left = chosen.get("left");
    const right = chosen.get("right");
    if (left) ordered.push(left);
    if (right) ordered.push(right);
    return ordered;
}
