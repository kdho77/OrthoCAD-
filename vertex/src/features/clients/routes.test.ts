// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { parseClinicalPath } from "./routes";

describe("clinical routes", () => {
    test("uses opaque ids and ignores names in the path", () => {
        const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const design = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        expect(parseClinicalPath("/")).toEqual({ kind: "home" });
        expect(parseClinicalPath("/clients")).toEqual({ kind: "list" });
        expect(parseClinicalPath(`/clients/${id}`)).toEqual({ kind: "file", clientId: id });
        expect(parseClinicalPath(`/clients/${id}/designs/${design}`)).toEqual({
            kind: "design",
            clientId: id,
            designId: design,
        });
        expect(parseClinicalPath("/clients/Doe-Jane")).toEqual({ kind: "list" });
        expect(parseClinicalPath("/clients/Doe-Jane/designs/Insole")).toEqual({ kind: "list" });
    });
});
