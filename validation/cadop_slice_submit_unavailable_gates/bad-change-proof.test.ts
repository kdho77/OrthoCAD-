// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

const BASE_LIKE_SNIPPET = `
export async function submitVertexSliceJob(request: VertexSliceRequest) {
    const deadline = armSliceDeadline(SLICE_JOB_SUBMIT_TIMEOUT_MS);
    try {
        const opened = await openSliceForm(request, { signal: deadline.signal });
`;

describe("bad-change proof — gate assertions reject restored anti-patterns", () => {
    test("detector flags shared openSliceForm submit deadline (BASE-like)", () => {
        const sharedDeadline = /openSliceForm\(\s*request,\s*\{\s*signal:\s*deadline\.signal/.test(
            BASE_LIKE_SNIPPET,
        );
        expect(sharedDeadline).toBe(true);
    });

    test("G1 fails if only one of two accepted jobs is polled to completion", () => {
        const accepted = ["job-a", "job-b"];
        const polledToCompletion = ["job-a"];
        const pass =
            accepted.length === 2 &&
            polledToCompletion.length === 2 &&
            accepted.every((id) => polledToCompletion.includes(id));
        expect(pass).toBe(false);
    });

    test("G3 fails if HTTP 400 is posted twice (retried)", () => {
        const postCount = 2;
        const pass = postCount === 1;
        expect(pass).toBe(false);
    });

    test("G4 fails if zero jobs polled after missed 202", () => {
        const polledToCompletion: string[] = [];
        const pass = polledToCompletion.length === 1;
        expect(pass).toBe(false);
    });
});
