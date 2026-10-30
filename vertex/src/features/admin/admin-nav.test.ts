// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { showSuperAdminLink } from "./admin-nav";

describe("super admin account-menu link", () => {
    test("only super_admin sees the Super admin link", () => {
        expect(showSuperAdminLink("super_admin")).toBe(true);
        expect(showSuperAdminLink("admin")).toBe(false);
        expect(showSuperAdminLink("clinician")).toBe(false);
        expect(showSuperAdminLink(null)).toBe(false);
    });
});
