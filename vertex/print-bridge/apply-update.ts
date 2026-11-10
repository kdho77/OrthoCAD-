// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Stages a signed update after the manifest has already been verified.
// The download is https-only and is kept only when the sha256 matches.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

export async function stageVerifiedUpdate(input: {
    url: string;
    sha256: string;
    destination: string;
    fetchImpl?: typeof fetch;
}): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
    let url: URL;
    try {
        url = new URL(input.url);
    } catch {
        return { ok: false, reason: "unexpected" };
    }
    if (url.protocol !== "https:" || url.username || url.password) return { ok: false, reason: "unexpected" };
    if (!/^[a-f0-9]{64}$/.test(input.sha256)) return { ok: false, reason: "unexpected" };
    const response = await (input.fetchImpl ?? fetch)(url, { redirect: "manual" });
    if (response.status < 200 || response.status >= 300) return { ok: false, reason: "unexpected" };
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== input.sha256) return { ok: false, reason: "tampered" };
    writeFileSync(input.destination, bytes, { mode: 0o600 });
    return { ok: true, bytes: bytes.length };
}
