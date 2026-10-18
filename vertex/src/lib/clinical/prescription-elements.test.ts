import { describe, expect, test } from "@rstest/core";
import { prescriptionElementsForAutomaticPlacement } from "./prescription-elements";

describe("prescription element placement", () => {
    test("keeps dancer's pads for deliberate manual placement", () => {
        const parsed = [
            { kind: "dancers_pad", side: "left" },
            { kind: "met_pad", side: "left" },
            { kind: "dancers_pad", side: "right" },
        ] as const;

        expect(prescriptionElementsForAutomaticPlacement([...parsed])).toEqual([
            { kind: "met_pad", side: "left" },
        ]);
    });
});
