// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    downloadVertexSliceJobResult,
    getVertexSliceJob,
} from "../../../vertex/server/src/lib/vertexslice-client.js";

export async function pollJobToTerminalGcode(jobId: string, maxPolls = 20): Promise<string> {
    for (let i = 0; i < maxPolls; i++) {
        const snap = await getVertexSliceJob(jobId);
        if (snap.kind === "job" && snap.job.status === "succeeded") {
            const result = await downloadVertexSliceJobResult(jobId);
            if (result.kind === "gcode") return result.gcode;
            throw new Error(`job ${jobId} succeeded but result was ${result.kind}`);
        }
        if (snap.kind === "job" && snap.job.status === "failed") {
            throw new Error(`job ${jobId} failed: ${snap.job.error ?? "unknown"}`);
        }
    }
    throw new Error(`job ${jobId} did not reach succeeded within ${maxPolls} polls`);
}
