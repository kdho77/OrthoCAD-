// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { CameraView } from "@/stores/design-store";
import { sideOffsetX } from "./layout";
import {
    furtherScreenLeft,
    instanceWorldPosition,
    projectViewNdcX,
    VIEW_CAMERA_POS,
    viewCameraUp,
} from "./viewport-side-layout";

const ANATOMICAL: CameraView[] = ["iso", "front", "back", "left", "top", "bottom"];

describe("viewport side layout (T24–T27)", () => {
    test("T27: eye-toggle side ids match mesh instance placement keys", () => {
        // showLeft / showRight gate side="left" / side="right" meshes; offsets must differ.
        expect(sideOffsetX("left")).not.toBe(sideOffsetX("right"));
        expect(instanceWorldPosition("left").z).not.toBe(instanceWorldPosition("right").z);
        // Left local −Y → world +Z after Rx(−90°).
        expect(instanceWorldPosition("left").z).toBeGreaterThan(instanceWorldPosition("right").z);
    });

    test("T25: left instance projects further screen-left than right for anatomical presets", () => {
        for (const view of ANATOMICAL) {
            const lx = projectViewNdcX(view, instanceWorldPosition("left"));
            const rx = projectViewNdcX(view, instanceWorldPosition("right"));
            expect(lx).toBeLessThan(rx);
            expect(furtherScreenLeft(view)).toBe("left");
        }
    });

    test("T24: hiding right removes the screen-right instance (not screen-left)", () => {
        for (const view of ANATOMICAL) {
            // Remaining visible after hide-right is left, which must be further screen-left.
            expect(furtherScreenLeft(view)).toBe("left");
            const lx = projectViewNdcX(view, instanceWorldPosition("left"));
            const rx = projectViewNdcX(view, instanceWorldPosition("right"));
            expect(rx).toBeGreaterThan(lx);
        }
    });

    test("T26: Bottom keeps ipsilateral L/R (no plantar transpose)", () => {
        expect(furtherScreenLeft("top")).toBe("left");
        expect(furtherScreenLeft("bottom")).toBe("left");
        // Opposite up vectors cancel the view-from-below mirror so sliders stay ipsilateral.
        expect(viewCameraUp("top")).toEqual([-1, 0, 0]);
        expect(viewCameraUp("bottom")).toEqual([1, 0, 0]);
        expect(VIEW_CAMERA_POS.top[1]).toBeGreaterThan(0);
        expect(VIEW_CAMERA_POS.bottom[1]).toBeLessThan(0);
    });
});
