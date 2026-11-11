import { describe, expect, test } from "@rstest/core";
import type { Side, SideCorrections } from "@/types";
import { readStoredDesignSettings } from "../../../shared/design-settings";
import { infillFractionFromRecipe } from "../../../shared/print-recipe/print-recipe";
import {
    ARCH_APEX_SHIFT_MM_MAX,
    ARCH_APEX_SHIFT_MM_MIN,
    ARCH_RAISE_MM_MAX,
    ARCH_RAISE_MM_MIN,
    parseSavedDesignCatalog,
    SavedDesignSnapshotError,
    type StoredLinkShoe,
} from "../../../shared/saved-design-catalog";
import { designStateFromSavedSettings } from "../../features/exports/saved-design-finalized-mesh";
import { CLINICAL_LIMITS } from "../geometry/clinical-constraints";
import { defaultElementPose, ELEMENT_PROFILES } from "../geometry/elements";
import { type HeightFieldParams, heightAt } from "../geometry/height-field";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_GLB_PATH } from "../geometry/procedural-wall/sample-top-id";
import { insoleLayoutForUsMenSize } from "../geometry/shoe-size";
import { SINK_DEFAULT_DEPTH_MM, SINK_PROFILES } from "../geometry/sink";
import { buildSavedDesignSnapshot } from "./saved-design-snapshot";

const storedNine: StoredLinkShoe = {
    system: "US_M",
    size: 9,
    left: null,
    right: null,
    width: null,
};

function build(catalog: unknown, stored = storedNine) {
    return buildSavedDesignSnapshot({
        stored,
        catalog: parseSavedDesignCatalog(catalog),
    });
}

function expect422(fn: () => void) {
    try {
        fn();
        throw new Error("expected 422");
    } catch (error) {
        expect(error).toBeInstanceOf(SavedDesignSnapshotError);
        expect((error as SavedDesignSnapshotError).status).toBe(422);
        expect((error as Error).message).toMatch(/^422 /);
        return error as SavedDesignSnapshotError;
    }
}

describe("SAMPLE_Top saved-design snapshot", () => {
    test("a null catalog becomes a loftable snapshot and omitted fields stay unset", () => {
        const built = build({});
        const envelope = { schemaVersion: 1, settings: built.design };
        const settings = readStoredDesignSettings(envelope);
        expect(settings?.usMenSize).toBe(9);
        expect(settings?.sizeSystem).toBe("us");
        expect(settings?.shoeWidth).toBe("medium");
        expect(built.shoeWidthSource).toBe("defaulted");
        expect(built.hardnessSource).toBe("unspecified");
        expect(built.design.dogfoodManufacturing).toMatchObject({
            template: "SAMPLE_Top",
            scansUsed: false,
            shoeWidth: "medium",
            shoeWidthSource: "defaulted",
            hardness: null,
            hardnessSource: "unspecified",
        });
        expect(built.design.elements).toEqual([]);
        expect(built.design.corrections.left.archHeightMm).toBe(0);
        expect(built.design.corrections.right.archHeightMm).toBe(0);
        expect(built.design.corrections.left.apexMoveMm).toBe(0);
        expect(built.design.corrections.left.heelLiftMm).toBe(0);
        expect(built.design.corrections.left.rearfootWedge).toBeUndefined();
        expect(built.paths.some((path) => path.includes("archHeightMm") || path.includes("apexMoveMm"))).toBe(
            false,
        );
        expect(built.design.base?.assetId).toBe(SAMPLE_TOP_ASSET_ID);
        expect(built.design.base?.glbPath).toBe(SAMPLE_TOP_GLB_PATH);
        expect(built.design.paired?.rightBase?.mirrored).toBe(true);
        const lofted = designStateFromSavedSettings(envelope);
        expect(lofted.usMenSize).toBe(9);
        expect(lofted.elements).toEqual([]);
        expect(lofted.base?.glbPath).toBe(SAMPLE_TOP_GLB_PATH);
    });

    test("stored link size and width are copied", () => {
        const mens = build({}, { ...storedNine, size: 10.5, width: "wide" });
        expect(mens.usMenSize).toBe(10.5);
        expect(mens.design.shoeWidth).toBe("wide");
        expect(mens.shoeWidthSource).toBe("prescribed");
        const womens = build({}, { ...storedNine, system: "US_W", size: 8, width: "narrow" });
        expect(womens.usMenSize).toBe(6.5);
        expect(womens.design.shoeWidth).toBe("narrow");
    });

    test("rx text and rigidity do not create clinical corrections", () => {
        const built = build({
            rx_text: "Morton's extension, flexible foot, arch high",
            notes: "Extra Soft shell with Morton's",
            rigidity: "Extra Soft",
            extra_soft: true,
            hardness: "Extra Soft",
        });
        expect(built.design.elements).toEqual([]);
        expect(built.design.corrections.left.apexMoveMm).toBe(0);
        expect(built.design.corrections.left.archHeightMm).toBe(0);
        expect(built.design.printRecipe?.defaultHardness).toBe("Extra Soft");
        expect(built.hardnessSource).toBe("prescribed");
        expect(built.ignoredFields).toEqual(["rx_text", "notes", "rigidity", "extra_soft"]);
        expect(JSON.stringify(built.design)).not.toMatch(/Morton|Extra Soft shell/i);
    });

    test("arch maps only from a structured Low/Medium/High value", () => {
        expect(build({ arch: "Low" }).design.corrections.left.archHeightMm).toBe(-3.5);
        expect(build({ arch: "Medium" }).design.corrections.right.archHeightMm).toBe(0);
        expect(build({ arch: "Standard" }).design.corrections.left.archHeightMm).toBe(0);
        expect(build({ arch: "High" }).design.corrections.right.archHeightMm).toBe(3);
    });

    test("flexible apex is +4 mm only when flexible_foot is true", () => {
        const marked = build({ flexible_foot: true, rigidity: "Extra Soft" });
        expect(marked.design.corrections.left.apexMoveMm).toBe(4);
        expect(marked.design.corrections.right.apexMoveMm).toBe(4);
        expect(build({ flexible_foot: false, extra_soft: true }).design.corrections.left.apexMoveMm).toBe(0);
    });

    test("named elements use the built-in magnitude unless a number is supplied", () => {
        const named = build({
            elements: [{ name: "Morton's Ext.", side: "left" }],
        });
        expect(named.design.elements).toHaveLength(1);
        const element = named.design.elements[0];
        expect(element?.kind).toBe("mortons_extension");
        expect(element?.side).toBe("left");
        expect(element?.heightMm).toBe(ELEMENT_PROFILES.mortons_extension.defaultHeightMm);
        expect(element?.position).toEqual(defaultElementPose("mortons_extension", "left", 260, 95).position);
        const numbered = build({
            elements: [{ name: "mortons_extension", side: "right", height_mm: 3.5 }],
        });
        expect(numbered.design.elements[0]?.heightMm).toBe(3.5);
        expect(numbered.design.elements[0]?.side).toBe("right");
        expect(build({ sliders: { heel_lift_mm: 6 } }).design.corrections.left.heelLiftMm).toBe(6);
        expect(build({ sliders: { heel_lift_mm: 6 } }).paths).toContain(
            "settings.corrections.left.heelLiftMm",
        );
    });

    test("missing shoe size, EU, split sizes, and conflicts fail closed", () => {
        expect(expect422(() => build({}, { ...storedNine, size: null })).message).toMatch(
            /shoe size is required/,
        );
        expect(expect422(() => build({}, { ...storedNine, system: "EU" })).message).toMatch(/EU/);
        expect(expect422(() => build({}, { ...storedNine, left: 9, right: 10 })).message).toMatch(
            /left and right shoe sizes differ/,
        );
        expect(
            expect422(() => build({ shoe_size: { system: "US_M", size: 10 } }, storedNine)).message,
        ).toMatch(/disagrees/);
        expect(expect422(() => build({ width: "wide" }, { ...storedNine, width: "medium" })).message).toMatch(
            /width disagrees/,
        );
        expect(
            expect422(() => build({ elements: [{ name: "not a real pad", side: "left" }] })).message,
        ).toMatch(/unrecognized element/);
        expect(expect422(() => parseSavedDesignCatalog({ invented_mm: 4 })).message).toMatch(
            /invalid catalog field/,
        );
    });

    test("1st met head aliases write an mpj1 sink on each named side and leave u and v unset", () => {
        const aliases = ["mpj1", "1st MPJ", "1st met head"] as const;
        for (const name of aliases) {
            const built = build({
                sinks: [
                    { name, side: "left", depth_mm: 1.5 },
                    { kind: name, side: "right", depth_mm: 1.5 },
                ],
            });
            expect(built.design.corrections.left.forefootWedge).toBeUndefined();
            expect(built.design.corrections.right.forefootWedge).toBeUndefined();
            expect(built.design.elements).toEqual([]);
            expect(built.paths).toContain("settings.sinks");
            for (const side of ["left", "right"] as const) {
                const sink = built.design.sinks?.[side]?.[0];
                expect(sink).toEqual({
                    id: `snapshot-sink-mpj1-${side}`,
                    kind: "mpj1",
                    depthMm: 1.5,
                });
                expect(sink?.u).toBeUndefined();
                expect(sink?.v).toBeUndefined();
            }
            expect(built.design.sinks?.left?.[0]).not.toBe(built.design.sinks?.right?.[0]);
        }
        const placed = build({
            sinks: [{ name: "mpj1", side: "left", depth_mm: 1.5, u: 0.7, v: 0.2 }],
        });
        expect(placed.design.sinks?.left?.[0]).toEqual({
            id: "snapshot-sink-mpj1-left",
            kind: "mpj1",
            depthMm: 1.5,
            u: 0.7,
            v: 0.2,
        });
    });

    test("an omitted sink depth uses the 2 mm library default and a left-only sink stays on the left", () => {
        const built = build({ sinks: [{ name: "1st metatarsal head", side: "left" }] });
        expect(SINK_DEFAULT_DEPTH_MM).toBe(2);
        expect(SINK_PROFILES.mpj1.defaultDepthMm).toBe(2);
        expect(SINK_PROFILES.mpj1.maxDepthMm).toBe(4);
        expect(built.design.sinks?.left).toEqual([
            { id: "snapshot-sink-mpj1-left", kind: "mpj1", depthMm: 2 },
        ]);
        expect(built.design.sinks?.right).toBeUndefined();
        expect(built.design.corrections.left.forefootWedge).toBeUndefined();
    });

    test("depth 0, negative, or above the mpj1 maximum is a 422 and does not return a design", () => {
        for (const depth_mm of [0, -0.5, 5]) {
            const error = expect422(() =>
                build({ sinks: [{ name: "1st met head", side: "right", depth_mm }] }),
            );
            expect(error.message).toMatch(/depth/);
            expect(error.message).toMatch(/4 mm/);
        }
        expect(
            expect422(() => build({ sinks: [{ name: "not a real sink", side: "left" }] })).message,
        ).toMatch(/unrecognized sink/);
        expect(expect422(() => build({ sinks: [{ side: "left", depth_mm: 1.5 }] })).message).toMatch(
            /name or kind/,
        );
        expect(
            expect422(() =>
                build({
                    sinks: [
                        { name: "mpj1", side: "left", depth_mm: 1.5 },
                        { name: "1st MPJ", side: "left", depth_mm: 2 },
                    ],
                }),
            ).message,
        ).toMatch(/One of each kind per side/);
    });

    test("elements stay raises, including heel_sink, when a met-head sink is also present", () => {
        const built = build({
            elements: [
                { name: "Met Pad", side: "left", height_mm: 4 },
                { name: "Heel Sink", side: "right" },
                { name: "Dancer's pad (1st MPJ relief)", side: "left" },
            ],
            sinks: [{ name: "1st met head", side: "left", depth_mm: 1.5 }],
        });
        expect(
            built.design.elements.map((element) => ({
                kind: element.kind,
                heightMm: element.heightMm,
                side: element.side,
            })),
        ).toEqual([
            { kind: "met_pad", heightMm: 4, side: "left" },
            { kind: "heel_sink", heightMm: ELEMENT_PROFILES.heel_sink.defaultHeightMm, side: "right" },
            { kind: "dancers_pad", heightMm: ELEMENT_PROFILES.dancers_pad.defaultHeightMm, side: "left" },
        ]);
        expect(built.design.sinks?.left?.[0]?.kind).toBe("mpj1");
        expect(built.design.sinks?.left?.[0]?.depthMm).toBe(1.5);
        expect(built.design.sinks?.right).toBeUndefined();
        expect(built.design.elements.some((element) => element.kind === "mpj1")).toBe(false);
    });

    test("an omitted forefoot wedge stays absent when a sink is present", () => {
        const withSink = build({
            sinks: [
                { name: "mpj1", side: "left", depth_mm: 1.5 },
                { name: "mpj1", side: "right", depth_mm: 1.5 },
            ],
        });
        expect(withSink.design.corrections.left.forefootWedge).toBeUndefined();
        expect(withSink.design.corrections.right.forefootWedge).toBeUndefined();
        expect(withSink.design.corrections.left.rearfootWedge).toBeUndefined();
        const raised = build({
            elements: [{ name: "heel_sink", side: "left", height_mm: 3 }],
        });
        expect(raised.design.elements[0]?.kind).toBe("heel_sink");
        expect(raised.design.elements[0]?.heightMm).toBe(3);
        expect(raised.design.sinks).toBeUndefined();
    });

    test("another library sink uses its profile default and rejects a depth above its maximum", () => {
        const omitted = build({ sinks: [{ name: "2nd MPJ", side: "right" }] });
        expect(omitted.design.sinks?.right).toEqual([
            { id: "snapshot-sink-mpj2-right", kind: "mpj2", depthMm: SINK_PROFILES.mpj2.defaultDepthMm },
        ]);
        expect(omitted.design.sinks?.left).toBeUndefined();
        expect(SINK_PROFILES.mpj2.maxDepthMm).toBe(3);
        expect(
            expect422(() => build({ sinks: [{ kind: "mpj2", side: "right", depth_mm: 4 }] })).message,
        ).toMatch(/at most 3 mm/);
        expect(
            build({ sinks: [{ name: "2nd met head", side: "left", depth_mm: 3 }] }).design.sinks?.left?.[0]
                ?.depthMm,
        ).toBe(3);
    });

    test("Morton's and a reverse kinetic wedge on the same foot are refused", () => {
        expect(
            expect422(() =>
                build({
                    elements: [{ name: "Morton's Ext.", side: "left" }],
                    sinks: [{ name: "Reverse kinetic wedge", side: "left", depth_mm: 2 }],
                }),
            ).message,
        ).toMatch(/cannot be on the same foot/);
        const opposite = build({
            elements: [{ name: "mortons_extension", side: "left" }],
            sinks: [
                { kind: "mpj1", side: "left", depth_mm: 1.5 },
                { kind: "rkw", side: "right", depth_mm: 2 },
            ],
        });
        expect(opposite.design.elements[0]?.kind).toBe("mortons_extension");
        expect(opposite.design.sinks?.left?.[0]?.kind).toBe("mpj1");
        expect(opposite.design.sinks?.right?.[0]?.kind).toBe("rkw");
        const bothStored = build({
            sinks: [
                { name: "1st MPJ", side: "left", depth_mm: 1.5 },
                { name: "rkw", side: "left", depth_mm: 2 },
            ],
        });
        expect(bothStored.design.sinks?.left?.map((sink) => sink.kind)).toEqual(["mpj1", "rkw"]);
    });

    test("arch raise and apex shift use the Arch slider bounds and sign", () => {
        expect(ARCH_RAISE_MM_MIN).toBe(CLINICAL_LIMITS.archHeightMm.min);
        expect(ARCH_RAISE_MM_MAX).toBe(CLINICAL_LIMITS.archHeightMm.max);
        expect(ARCH_APEX_SHIFT_MM_MIN).toBe(CLINICAL_LIMITS.apexMoveMm.min);
        expect(ARCH_APEX_SHIFT_MM_MAX).toBe(CLINICAL_LIMITS.apexMoveMm.max);
        expect(
            parseSavedDesignCatalog({
                arch_raise_mm: ARCH_RAISE_MM_MIN,
                arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MIN,
            }),
        ).toMatchObject({ arch_raise_mm: -10, arch_apex_shift_mm: -12 });
        expect(
            parseSavedDesignCatalog({
                arch_raise_mm: ARCH_RAISE_MM_MAX,
                arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MAX,
            }),
        ).toMatchObject({ arch_raise_mm: 14, arch_apex_shift_mm: 12 });
        for (const catalog of [
            { arch_raise_mm: ARCH_RAISE_MM_MIN - 0.001 },
            { arch_raise_mm: ARCH_RAISE_MM_MAX + 0.001 },
            { arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MIN - 0.001 },
            { arch_apex_shift_mm: ARCH_APEX_SHIFT_MM_MAX + 0.001 },
            { arch_raise_mm: Number.POSITIVE_INFINITY },
            { arch_by_side: { left: { arch_apex_shift_mm: 12.001 } } },
        ]) {
            expect(expect422(() => parseSavedDesignCatalog(catalog)).message).toMatch(/arch_/);
        }
    });

    test("+3 mm raise and forward 4 mm apex match the arch sliders and move the dome", () => {
        const plain = build({});
        const preset = build({ arch: "high", flexible_foot: true });
        const numeric = build({ arch_raise_mm: 3, arch_apex_shift_mm: 4 });
        const back = build({ arch_raise_mm: 3, arch_apex_shift_mm: -4 });
        expect(preset.design.corrections.left.archHeightMm).toBe(3);
        expect(preset.design.corrections.left.apexMoveMm).toBe(4);
        expect(preset.design.corrections.right).toMatchObject({
            archHeightMm: 3,
            apexMoveMm: 4,
            archFillMm: 0,
        });
        expect(numeric.design.corrections.linked).toBe(true);
        for (const side of ["left", "right"] as const) {
            expect(numeric.design.corrections[side]).toEqual({
                ...plain.design.corrections[side],
                archHeightMm: 3,
                apexMoveMm: 4,
            });
            expect(numeric.design.corrections[side].archFillMm).toBe(0);
            expect(back.design.corrections[side].apexMoveMm).toBe(-4);
        }
        expect(numeric.design.printRecipe).toEqual(plain.design.printRecipe);
        const numericRecipe = numeric.design.printRecipe;
        const plainRecipe = plain.design.printRecipe;
        if (!numericRecipe || !plainRecipe) throw new Error("print recipe missing");
        expect(infillFractionFromRecipe(numericRecipe)).toBe(infillFractionFromRecipe(plainRecipe));
        expect(build({ arch: "high", arch_raise_mm: 3 }).design.corrections.left.archHeightMm).toBe(3);
        expect(
            build({ flexible_foot: true, arch_apex_shift_mm: 4 }).design.corrections.right.apexMoveMm,
        ).toBe(4);
        expect(
            build({ flexible_foot: false, arch_apex_shift_mm: -4 }).design.corrections.left.apexMoveMm,
        ).toBe(-4);
        expect(expect422(() => build({ arch: "high", arch_raise_mm: 5 })).message).toMatch(
            /disagrees with arch/,
        );
        expect(expect422(() => build({ flexible_foot: true, arch_apex_shift_mm: -4 })).message).toMatch(
            /disagrees with flexible_foot/,
        );
        expect(
            expect422(() =>
                build({
                    arch_raise_mm: 3,
                    arch_by_side: { left: { arch_raise_mm: 3 } },
                }),
            ).message,
        ).toMatch(/not both/);

        const layout = insoleLayoutForUsMenSize(numeric.usMenSize);
        const ui = uiArchCorrections(3, 4);
        expect(archDome(numeric.design.corrections.left, layout.lengthMm, layout.widthMm, "left")).toEqual(
            archDome(ui, layout.lengthMm, layout.widthMm, "left"),
        );
        const forward = archPeak(numeric.design.corrections.left, layout.lengthMm, layout.widthMm, "left");
        const posterior = archPeak(back.design.corrections.left, layout.lengthMm, layout.widthMm, "left");
        const right = archPeak(numeric.design.corrections.right, layout.lengthMm, layout.widthMm, "right");
        expect(forward.peakRaiseMm).toBeCloseTo(3, 1);
        expect(right.peakRaiseMm).toBeCloseTo(3, 1);
        expect(posterior.peakRaiseMm).toBeCloseTo(3, 1);
        expect(forward.peakXMm - 0.42 * layout.lengthMm).toBeCloseTo(4, 0);
        expect(right.peakXMm - 0.42 * layout.lengthMm).toBeCloseTo(4, 0);
        expect(posterior.peakXMm - 0.42 * layout.lengthMm).toBeCloseTo(-4, 0);
        const oldU = 0.42;
        expect(raiseAt(numeric.design.corrections.left, layout, "left", forward.peakU)).toBeGreaterThan(
            raiseAt(numeric.design.corrections.left, layout, "left", oldU),
        );

        const split = build({
            arch_by_side: {
                left: { arch_raise_mm: 3, arch_apex_shift_mm: 4 },
                right: { arch_raise_mm: 1, arch_apex_shift_mm: -6 },
            },
        });
        expect(split.design.corrections.linked).toBe(false);
        expect(split.design.corrections.left).toMatchObject({
            archHeightMm: 3,
            apexMoveMm: 4,
            archFillMm: 0,
        });
        expect(split.design.corrections.right).toMatchObject({
            archHeightMm: 1,
            apexMoveMm: -6,
            archFillMm: 0,
        });
        const leftPeak = archPeak(split.design.corrections.left, layout.lengthMm, layout.widthMm, "left");
        const rightPeak = archPeak(split.design.corrections.right, layout.lengthMm, layout.widthMm, "right");
        expect(leftPeak.peakRaiseMm).toBeCloseTo(3, 1);
        expect(rightPeak.peakRaiseMm).toBeCloseTo(1, 1);
        expect(leftPeak.peakXMm - rightPeak.peakXMm).toBeCloseTo(10, 0);
    });
});

/** Arch height slider value written the same way CorrectionsPanel commits archHeightMm. */
function uiArchCorrections(archHeightMm: number, apexMoveMm: number): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function archField(
    side: Side,
    corrections: SideCorrections,
    lengthMm: number,
    widthMm: number,
): HeightFieldParams {
    return {
        side,
        lengthMm,
        widthMm,
        thicknessMm: 3,
        corrections,
        includeElements: false,
        includeSkives: false,
    };
}

/** Medial sample used by the arch-class height check. Right medial v is the opposite sign. */
function medialV(side: Side): number {
    return side === "left" ? 0.86 : -0.86;
}

function raiseAt(
    corrections: SideCorrections,
    layout: { lengthMm: number; widthMm: number },
    side: Side,
    u: number,
): number {
    const v = medialV(side);
    const raised = heightAt(u, v, archField(side, corrections, layout.lengthMm, layout.widthMm));
    const base = heightAt(
        u,
        v,
        archField(
            side,
            { ...corrections, archHeightMm: 0, apexMoveMm: 0, archFillMm: 0 },
            layout.lengthMm,
            layout.widthMm,
        ),
    );
    return raised - base;
}

function archDome(corrections: SideCorrections, lengthMm: number, widthMm: number, side: Side): number[] {
    const v = medialV(side);
    const samples: number[] = [];
    for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        samples.push(heightAt(u, v, archField(side, corrections, lengthMm, widthMm)));
    }
    return samples;
}

function archPeak(corrections: SideCorrections, lengthMm: number, widthMm: number, side: Side) {
    const layout = { lengthMm, widthMm };
    let peakU = 0;
    let peakRaiseMm = -Infinity;
    const steps = 1000;
    for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const delta = raiseAt(corrections, layout, side, u);
        if (delta > peakRaiseMm) {
            peakRaiseMm = delta;
            peakU = u;
        }
    }
    return { peakU, peakXMm: peakU * lengthMm, peakRaiseMm };
}
