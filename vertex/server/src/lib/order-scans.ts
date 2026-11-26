// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Foot-scan bytes stored on a client chart. Read only when a design opts in.

import type { PrismaClient } from "@prisma/client";
import type { OrderScanFile } from "../../../src/lib/clinical/order-scan-file.js";

export async function loadClientFootScans(prisma: PrismaClient, clientId: string): Promise<OrderScanFile[]> {
    const rows = await prisma.clientScan.findMany({
        where: { clientId },
        select: {
            id: true,
            side: true,
            fileName: true,
            uploadedAt: true,
            blob: { select: { body: true } },
        },
    });
    const files: OrderScanFile[] = [];
    for (const row of rows) {
        if (!row.blob) continue;
        if (row.side !== "left" && row.side !== "right") continue;
        files.push({
            id: row.id,
            side: row.side,
            fileName: row.fileName,
            uploadedAt: row.uploadedAt.toISOString(),
            bytes: new Uint8Array(row.blob.body),
        });
    }
    return files;
}
