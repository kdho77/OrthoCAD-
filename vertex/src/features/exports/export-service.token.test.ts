// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";

const mockBuildExportStl = rs.fn<() => Promise<ArrayBuffer>>();
const mockAuthorizeMutate = rs.fn<() => Promise<{ ok: boolean; balance: number }>>();

function makeStlBuffer(): ArrayBuffer {
    const buffer = new ArrayBuffer(256);
    const view = new Uint8Array(buffer);
    view[80] = 1;
    return buffer;
}

rs.mock("@/lib/geometry/export-geometry", () => ({
    buildExportStl: (...args: unknown[]) => mockBuildExportStl(...(args as [])),
    buildExportGlb: rs.fn(),
    buildExportGeometry: rs.fn(),
    exportModeFromMethod: () => "manufacturing",
    ExportGeometryNotReadyError: class ExportGeometryNotReadyError extends Error {},
    ExportKernelUnavailableError: class ExportKernelUnavailableError extends Error {},
    ExportOcctSewFailedError: class ExportOcctSewFailedError extends Error {
        constructor(message?: string) {
            super(message);
            this.name = "ExportOcctSewFailedError";
        }
    },
    ExportTimeoutError: class ExportTimeoutError extends Error {},
}));

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        export: {
            authorize: {
                mutate: (...args: unknown[]) => mockAuthorizeMutate(...(args as [])),
            },
        },
    },
}));

rs.mock("@/stores/auth-store", () => ({
    useAuthStore: {
        getState: () => ({
            user: { tokenBalance: 5 },
            license: null,
            deductTokens: rs.fn(),
            setUser: rs.fn(),
        }),
    },
}));

rs.mock("@/stores/design-store", () => ({
    useDesignStore: {
        getState: () => ({
            design: { method: "printing_solid" },
        }),
    },
}));

rs.mock("@/stores/audit-store", () => ({
    useAuditStore: {
        getState: () => ({
            record: rs.fn(),
        }),
    },
}));

rs.mock("@/features/licensing/license", () => ({
    canExport: () => ({ ok: true }),
    TOKEN_COST: { stl: 1, gcode: 1, glb: 0 },
}));

describe("export-service token invariant", () => {
    beforeEach(() => {
        mockBuildExportStl.mockReset();
        mockAuthorizeMutate.mockReset();
        mockBuildExportStl.mockResolvedValue(makeStlBuffer());
        mockAuthorizeMutate.mockResolvedValue({ ok: true, balance: 4 });
        rs.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
        rs.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    });

    test("deducts token only after STL is built and download starts", async () => {
        const callOrder: string[] = [];
        mockBuildExportStl.mockImplementation(async () => {
            callOrder.push("buildExportStl");
            return makeStlBuffer();
        });
        mockAuthorizeMutate.mockImplementation(async () => {
            callOrder.push("authorize");
            return { ok: true, balance: 4 };
        });

        const originalCreateElement = document.createElement.bind(document);
        rs.spyOn(document, "createElement").mockImplementation((tag: string) => {
            const el = originalCreateElement(tag);
            if (tag === "a") {
                rs.spyOn(el, "click").mockImplementation(() => {
                    callOrder.push("download");
                });
            }
            return el;
        });

        const { exportDesign } = await import("@/features/exports/export-service");
        const result = await exportDesign("stl", "left");

        expect(result.ok).toBe(true);
        expect(mockBuildExportStl).toHaveBeenCalledTimes(1);
        expect(mockAuthorizeMutate).toHaveBeenCalledTimes(1);
        expect(callOrder).toEqual(["buildExportStl", "download", "authorize"]);
    });

    test("does not authorize when STL build fails", async () => {
        const { ExportOcctSewFailedError } = await import("@/lib/geometry/export-geometry");
        mockBuildExportStl.mockRejectedValue(new ExportOcctSewFailedError("OCCT sewing failed"));

        const { exportDesign } = await import("@/features/exports/export-service");
        const result = await exportDesign("stl", "left");

        expect(result.ok).toBe(false);
        expect(mockBuildExportStl).toHaveBeenCalledTimes(1);
        expect(mockAuthorizeMutate).not.toHaveBeenCalled();
    });
});
