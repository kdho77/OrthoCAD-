// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { defaultShoeChart, formatClientShoeSummary, shoeChartFromInput } from "../../../shared/client-files";
import { clientFileHeaderParts } from "./ClientFileHeaderSummary";

describe("ClientFileHeaderSummary", () => {
    test("shows shoe size, ordered by, and reference when set", () => {
        const client = {
            id: "c1",
            ownerId: "u1",
            tenantId: null,
            displayName: "Jane Doe",
            firstName: "Jane",
            lastName: "Doe",
            reference: "REF-42",
            orderedBy: "Apex Clinic",
            dateOfBirth: null,
            mrn: null,
            email: null,
            phone: null,
            notes: null,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            ...shoeChartFromInput({ shoeSizeUs: 10.5, shoeWidth: "wide" }),
        };
        expect(clientFileHeaderParts(client)).toEqual([
            formatClientShoeSummary(shoeChartFromInput({ shoeSizeUs: 10.5, shoeWidth: "wide" })),
            "Ordered by Apex Clinic",
            "Ref REF-42",
        ]);
    });

    test("omits reference when blank", () => {
        const client = {
            id: "c1",
            ownerId: "u1",
            tenantId: null,
            displayName: "Jane",
            firstName: "Jane",
            lastName: "",
            reference: null,
            orderedBy: "Direct OrthoCAD",
            dateOfBirth: null,
            mrn: null,
            email: null,
            phone: null,
            notes: null,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            ...defaultShoeChart(),
        };
        expect(clientFileHeaderParts(client)).toEqual([
            formatClientShoeSummary(defaultShoeChart()),
            "Ordered by Direct OrthoCAD",
        ]);
    });
});
