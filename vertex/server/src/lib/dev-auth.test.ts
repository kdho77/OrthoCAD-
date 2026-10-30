// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { DEV_SUPER_ADMIN, resolveDevRole } from "./dev-auth.js";

describe("resolveDevRole", () => {
    test("founder email allowlist wins over a users-table admin role", () => {
        expect(resolveDevRole(DEV_SUPER_ADMIN.email, "admin")).toBe("super_admin");
        expect(resolveDevRole("kdho@vertexorthopedic.com", "clinician")).toBe("super_admin");
        expect(resolveDevRole("  KDHO@VertexOrthopedic.com  ", "admin")).toBe("super_admin");
    });

    test("non-founder emails keep the claimed DB or metadata role", () => {
        expect(resolveDevRole("clinic@example.com", "admin")).toBe("admin");
        expect(resolveDevRole("clinic@example.com", "clinician")).toBe("clinician");
        expect(resolveDevRole("clinic@example.com", undefined)).toBe("clinician");
    });
});
