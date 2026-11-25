// UI Print keeps its own TextMarkingError catch. This file does not loft.

import { describe, expect, test } from "@rstest/core";
import { defaultBottomTextMarking } from "../../vertex/shared/bottom-text-marking";

rs.mock("@/lib/geometry/procedural-wall/sample-top-preview", () => ({
    reconstructProceduralPreview: async () => {
        const { BufferAttribute: Attr, BufferGeometry: Geo } = await import("three");
        const geometry = new Geo();
        geometry.setAttribute("position", new Attr(new Float32Array([0, 0, 0, 40, 0, 0, 0, 20, 0]), 3));
        geometry.setIndex(new Attr(new Uint16Array([0, 1, 2]), 1));
        geometry.userData = { outlineRing: [], bottomOutlineB: [], wallFrames: [] };
        return { geometry, pattern: [], model: { id: "grader" } };
    },
    buildProceduralViewerPattern: () => [],
}));

rs.mock("@/lib/geometry/text-marking/apply", () => ({
    applyTextMarkingToPrintSolid: async () => {
        const { TextMarkingError } = await import("@/lib/geometry/text-marking/errors");
        throw new TextMarkingError("z0", "bottom z=0.400 outside the recess");
    },
}));

describe("G3 UI Print", () => {
    test("the print worker records textFitError and still returns the solid", async () => {
        const messages: Array<{
            type?: string;
            userData?: { textFitError?: string | null };
            message?: string;
        }> = [];
        const scope = self as unknown as {
            onmessage: ((event: { data: unknown }) => void) | null;
            postMessage: (data: unknown) => void;
        };
        scope.postMessage = (data) => {
            messages.push(data as (typeof messages)[number]);
        };
        await import("@/workers/procedural-wall.worker");
        const handler = scope.onmessage;
        expect(handler).toBeTypeOf("function");
        handler?.({
            data: {
                id: 1,
                type: "reconstruct",
                positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                indices: new Uint32Array([0, 1, 2]),
                options: {
                    side: "right",
                    textMarking: {
                        ...defaultBottomTextMarking(),
                        text: "JABBOUR",
                        addPatientName: false,
                        feet: "both",
                        mode: "engrave",
                    },
                },
            },
        });
        const deadline = Date.now() + 5_000;
        while (messages.length === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(messages[0]?.type, messages[0]?.message).toBe("geometry");
        expect(messages[0]?.userData?.textFitError ?? "").toContain("bottom z=0.400");
    });
});
