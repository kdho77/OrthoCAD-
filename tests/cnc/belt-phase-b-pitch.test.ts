// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    DEFAULT_APEX_PRINT_MATERIAL_ID,
    lockedProfileIdForApexMaterial,
    vertexSliceMaterialForApexMaterial,
} from "@/features/exports/apex-print-material";
import { exportMachineFamily, pairExportLayout } from "@/features/exports/machine-export-layout";
import { placeWorkpieces } from "@/lib/cnc/placement";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import {
    CAD_OPERATOR_BELT_ANGLE_DEG,
    CAD_OPERATOR_BELT_MATERIAL,
    CAD_OPERATOR_BELT_PROFILE_ID,
} from "../../vertex/server/src/auth/cad-operator.ts";
import { syntheticWorkpiece } from "./helpers";

const POCKET_PITCH_MM = 130.175;

describe("belt phase B does not move the CNC pockets", () => {
    test("belt is separate files and Idaho pitch stays 130.175 mm", () => {
        expect(
            exportMachineFamily({ method: "printing_solid", beltAngleDeg: CAD_OPERATOR_BELT_ANGLE_DEG }),
        ).toBe("belt");
        expect(pairExportLayout("belt")).toBe("separate-files");
        expect(pairExportLayout("cnc")).toBe("side-by-side");
        expect(pairExportLayout("bed")).toBe("side-by-side");
        expect(lockedProfileIdForApexMaterial(DEFAULT_APEX_PRINT_MATERIAL_ID)).toBe(
            CAD_OPERATOR_BELT_PROFILE_ID,
        );
        expect(vertexSliceMaterialForApexMaterial("ApexCore")).toBe(CAD_OPERATOR_BELT_MATERIAL);

        const profile = cloneProfile(IDAHO_PROFILE);
        const left = syntheticWorkpiece(profile, "left");
        const right = syntheticWorkpiece(profile, "right");
        right.outline = left.outline.map((point) => ({ ...point }));
        const placed = placeWorkpieces(profile, [left, right]);
        const leftPart = placed.find((part) => part.side === "left");
        const rightPart = placed.find((part) => part.side === "right");
        if (!leftPart || !rightPart) throw new Error("expected both pockets");
        expect(rightPart.ty - leftPart.ty).toBeCloseTo(POCKET_PITCH_MM, 6);
        expect(leftPart.tx).toBeCloseTo(rightPart.tx, 6);
        expect(profile.pockets[1]?.y - profile.pockets[0]?.y).toBe(POCKET_PITCH_MM);
    });
});
