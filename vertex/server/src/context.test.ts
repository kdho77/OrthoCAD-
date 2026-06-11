// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { createContext } from "./context.js";

describe("createContext", () => {
    test("exposes pooled and direct Prisma clients", async () => {
        const ctx = await createContext({
            req: {
                headers: { authorization: "Bearer dev:00000000-0000-4000-8000-000000000001" },
                socket: { remoteAddress: "127.0.0.1" },
            },
        } as Parameters<typeof createContext>[0]);

        expect(ctx.prisma).toBeDefined();
        expect(ctx.prismaDirect).toBeDefined();
        expect(typeof ctx.prisma.$transaction).toBe("function");
        expect(typeof ctx.prismaDirect.$transaction).toBe("function");
    });
});
