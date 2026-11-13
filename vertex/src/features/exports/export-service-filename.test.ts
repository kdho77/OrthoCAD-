// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { useClientStore } from "@/stores/client-store";
import { hybridGcodeFilename } from "./export-service";

beforeEach(() => {
    useClientStore.setState({
        activeClientId: "client-1",
        clients: [
            {
                id: "client-1",
                firstName: "Jane",
                lastName: "Doe",
                displayName: "",
                reference: "JD-1",
                dateOfBirth: null,
                notes: "",
                shoeChart: {
                    shoeSizeUs: 9,
                    shoeSizesSplit: false,
                    shoeSizeLeftUs: 9,
                    shoeSizeRightUs: 9,
                    shoeWidth: "medium",
                },
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                archivedAt: null,
            },
        ],
    });
});

describe("export-service user filenames", () => {
    test("hybridGcodeFilename uses the active client and Apex product id", () => {
        expect(hybridGcodeFilename("left", "ApexLight")).toBe("Jane_Doe_ApexLight_L.gcode");
        expect(hybridGcodeFilename("right", "apex_bounce")).toBe("Jane_Doe_ApexBounce_R.gcode");
    });
});
