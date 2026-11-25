import { createHash } from "node:crypto";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, PlacedElement } from "@/types";
import { SYNTHETIC_NAME } from "../../tests/name-plantar-e2e/thresholds.ts";
import { envelopeWithLoftTextMarking } from "../../vertex/server/src/lib/integration-text-marking.ts";
import { buildHeadlessFinalizedFootOffThread } from "../../vertex/server/src/lib/loft-worker-pool.ts";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings.ts";

function narrow(side: "left" | "right", named: boolean): unknown {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = 6;
    design.shoeWidth = "narrow";
    design.shoeWidthBySide = { left: "narrow", right: "narrow" };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, heelCupHeightMm: 9 },
        right: { ...design.corrections.right, heelCupHeightMm: 9 },
    };
    const layout = insoleLayoutFromDesign(design);
    const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
    const element: PlacedElement = {
        id: `met-${side}`,
        kind: "met_pad",
        side,
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: pose.heightMm,
        ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
    };
    design.elements = [element];
    design.textMarking = named
        ? { ...defaultTextMarking("bottom"), text: "", addPatientName: true, feet: "both", mode: "engrave" }
        : { ...defaultTextMarking("bottom"), text: "", addPatientName: false, feet: "both", mode: "engrave" };
    const raw = designSettingsEnvelope(design as unknown as Record<string, unknown>);
    return named ? envelopeWithLoftTextMarking(raw, SYNTHETIC_NAME, side) : raw;
}

const named = narrow("right", true);
const bare = narrow("right", false);
const namedText = JSON.stringify(named).includes(SYNTHETIC_NAME);
const bareText = JSON.stringify(bare).includes(SYNTHETIC_NAME);
console.log(JSON.stringify({ namedText, bareText }));
const [a, b] = await Promise.all([
    buildHeadlessFinalizedFootOffThread({ settingsJson: named, side: "right", includeLeader: true }),
    buildHeadlessFinalizedFootOffThread({ settingsJson: bare, side: "right", includeLeader: true }),
]);
const ha = createHash("sha256").update(Buffer.from(a.stl)).digest("hex");
const hb = createHash("sha256").update(Buffer.from(b.stl)).digest("hex");
console.log(
    JSON.stringify({
        equal: ha === hb,
        named: ha,
        bare: hb,
        namedTriangles: a.uploadTriangles,
        bareTriangles: b.uploadTriangles,
    }),
);
void (0 as unknown as DesignState);
