// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { postingMmAtStation, wedgeFromUiEntry } from "@/lib/geometry/posting-degrees";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { effectiveOutlineHalfWidth } from "@/lib/geometry/trimline";
import { getForefootFactor, wedgeDeltaAt } from "@/lib/geometry/wedge";
import type { DesignState, SideCorrections } from "@/types";
import { useDesignStore } from "./design-store";

function freshDesign(): DesignState {
    return JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
}

function outline() {
    const layout = insoleLayoutForUsMenSize(7.5);
    return { lengthMm: layout.lengthMm, widthMm: layout.widthMm };
}

beforeEach(() => {
    localStorage.removeItem("vertex-design-session");
    useDesignStore.setState({
        design: freshDesign(),
        pendingSessionDesign: null,
        history: [],
        future: [],
    });
});

describe("posting degree mode save and load", () => {
    test("new UI degree entries save and reload as degreeMode station", async () => {
        const store = useDesignStore.getState();
        store.setUsShoeSize(7.5);
        store.setShoeWidth("medium");
        const rear = wedgeFromUiEntry("medial", 2, "deg", true);
        const fore = wedgeFromUiEntry("medial", 2, "deg", true);
        expect(rear).toEqual({ side: "medial", value: 2, unit: "deg", degreeMode: "station" });
        expect(wedgeFromUiEntry("lateral", 4, "mm", true)).toEqual({ side: "lateral", value: 4, unit: "mm" });
        store.setRearfootWedge("left", rear);
        store.setForefootWedge("left", fore);

        const saved = JSON.parse(JSON.stringify(useDesignStore.getState().design)) as DesignState;
        expect(saved.corrections.left.rearfootWedge).toEqual(rear);
        expect(saved.corrections.left.forefootWedge).toEqual(fore);
        expect(saved.corrections.right.rearfootWedge).toEqual(rear);
        expect(saved.corrections.right.forefootWedge).toEqual(fore);
        expect(saved.usMenSize).toBe(7.5);

        useDesignStore.setState({ design: freshDesign() });
        useDesignStore.getState().loadDesign(saved);
        const loaded = useDesignStore.getState().design.corrections;
        expect(loaded.left.rearfootWedge).toEqual(rear);
        expect(loaded.left.forefootWedge).toEqual(fore);
        expect(loaded.right.forefootWedge?.degreeMode).toBe("station");

        const stationRise = wedgeDeltaAt(0.9, 1, "left", loaded.left, outline());
        expect(stationRise).toBeCloseTo(postingMmAtStation("forefoot", 2, outline()), 6);

        useDesignStore.setState({ design: freshDesign(), pendingSessionDesign: null });
        localStorage.setItem(
            "vertex-design-session",
            JSON.stringify({ state: { design: saved }, version: 0 }),
        );
        await useDesignStore.persist.rehydrate();
        if (useDesignStore.getState().pendingSessionDesign) useDesignStore.getState().resumeSession();
        const resumed = useDesignStore.getState().design.corrections.left;
        expect(resumed.rearfootWedge?.degreeMode).toBe("station");
        expect(resumed.forefootWedge).toEqual(fore);
    });

    test("a saved design without the flag reloads on the legacy degree path", async () => {
        const legacyRear = { side: "lateral" as const, value: 4, unit: "deg" as const };
        const legacyFore = { side: "lateral" as const, value: 4, unit: "deg" as const };
        const design = freshDesign();
        design.usMenSize = 7.5;
        design.corrections.linked = false;
        design.corrections.left.rearfootWedge = legacyRear;
        design.corrections.left.forefootWedge = legacyFore;
        design.corrections.right.rearfootWedge = legacyRear;
        design.corrections.right.forefootWedge = legacyFore;
        const saved = JSON.parse(JSON.stringify(design)) as DesignState;

        const params = outline();
        const u = 0.9;
        const before = wedgeDeltaAt(u, 1, "right", saved.corrections.right, params);
        const hw = effectiveOutlineHalfWidth(u, params.lengthMm, params.widthMm, null);
        const localFullWidth = 2 * hw * (params.widthMm / 2);
        const legacyRise = localFullWidth * Math.tan((4 * Math.PI) / 180) * getForefootFactor(u);
        expect(before).toBeCloseTo(legacyRise, 8);
        expect(Math.abs(before - postingMmAtStation("forefoot", 4, params))).toBeGreaterThan(0.5);

        useDesignStore.getState().loadDesign(saved);
        const loaded = useDesignStore.getState().design.corrections.right;
        expect(loaded.rearfootWedge).toEqual(legacyRear);
        expect(loaded.forefootWedge).toEqual(legacyFore);
        expect(loaded.rearfootWedge?.degreeMode).toBeUndefined();
        expect(loaded.forefootWedge?.degreeMode).toBeUndefined();
        expect(wedgeDeltaAt(u, 1, "right", loaded as SideCorrections, params)).toBe(before);

        useDesignStore.setState({ design: freshDesign(), pendingSessionDesign: null });
        localStorage.setItem(
            "vertex-design-session",
            JSON.stringify({ state: { design: saved }, version: 0 }),
        );
        await useDesignStore.persist.rehydrate();
        if (useDesignStore.getState().pendingSessionDesign) useDesignStore.getState().resumeSession();
        const resumed = useDesignStore.getState().design.corrections.right;
        expect(resumed.forefootWedge).toEqual(legacyFore);
        expect(resumed.rearfootWedge?.degreeMode).toBeUndefined();
        expect(wedgeDeltaAt(u, 1, "right", resumed, params)).toBe(before);
    });
});
