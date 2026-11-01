// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/** Shown once when a Pair export triggers two browser downloads. */
export const PAIR_MULTI_DOWNLOAD_HINT =
    "Your browser may ask to allow multiple downloads — choose Allow so Left and Right files both save.";

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Download Left then Right with a short gap so browsers treat them as separate saves. */
export async function downloadSequential(
    parts: Array<{ blob: Blob; filename: string }>,
    gapMs = 400,
): Promise<void> {
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        downloadBlob(part.blob, part.filename);
        if (i < parts.length - 1) await sleep(gapMs);
    }
}
