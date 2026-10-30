// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { generateCncJob } from "@/lib/cnc/export";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { CncExportError } from "@/lib/cnc/types";
import { syntheticWorkpiece } from "./helpers";

describe("CNC export errors", () => {
    test("part too tall", () => {
        const profile = cloneProfile();
        profile.materialHeightMm = 5;
        const wp = syntheticWorkpiece(profile);
        expect(() => generateCncJob(profile, [wp])).toThrow(CncExportError);
        try {
            generateCncJob(profile, [wp]);
        } catch (e) {
            expect((e as CncExportError).code).toBe("too_tall");
        }
    });

    test("does not fit the pocket", () => {
        const profile = cloneProfile();
        profile.pockets = [{ x: 0, y: 0, width: 20, length: 10 }];
        const wp = syntheticWorkpiece(profile);
        try {
            generateCncJob(profile, [wp]);
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(CncExportError);
            expect((e as CncExportError).code).toBe("no_fit");
        }
    });

    test("outline not closed", () => {
        const profile = cloneProfile();
        const wp = syntheticWorkpiece(profile);
        wp.outline = [
            { x: 0, y: 0, z: 5 },
            { x: 10, y: 0, z: 5 },
        ];
        try {
            generateCncJob(profile, [wp]);
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(CncExportError);
            expect((e as CncExportError).code).toBe("outline_open");
        }
        void IDAHO_PROFILE;
    });
});
