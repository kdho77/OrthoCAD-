// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useState } from "react";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import type { CncWorkpiece, MillingProfile } from "@/lib/cnc/types";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import type { Side } from "@/types";

interface MillLoadMemo {
    design: unknown;
    exportSide: Side;
    profile: MillingProfile;
    promise: Promise<CncWorkpiece[]>;
}

let millLoadMemo: MillLoadMemo | null = null;

function disposeWorkpieceMeshes(parts: CncWorkpiece[]): void {
    for (const part of parts) {
        part.mesh?.dispose();
        part.mesh = undefined;
    }
}

function loadMillWorkpieces(
    design: ReturnType<typeof useDesignStore.getState>["design"],
    exportSide: Side,
    profile: MillingProfile,
): Promise<CncWorkpiece[]> {
    if (
        millLoadMemo &&
        millLoadMemo.design === design &&
        millLoadMemo.exportSide === exportSide &&
        millLoadMemo.profile === profile
    ) {
        return millLoadMemo.promise;
    }
    const previous = millLoadMemo;
    const sides: Side[] = design.paired ? ["left", "right"] : [exportSide];
    const promise = workpiecesFromDesign(design, sides, profile).then((parts) => {
        if (previous) {
            void previous.promise.then(disposeWorkpieceMeshes).catch(() => {
                /* previous load failed; nothing to dispose */
            });
        }
        return parts;
    });
    millLoadMemo = { design, exportSide, profile, promise };
    return promise;
}

export function useMillWorkpieces(): { parts: CncWorkpiece[]; loading: boolean } {
    const design = useDesignStore((s) => s.design);
    const exportSide = useDesignStore((s) => s.exportSide);
    const profile = useMillingProfileStore((s) => s.profile);
    const [parts, setParts] = useState<CncWorkpiece[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let live = true;
        setLoading(true);
        void loadMillWorkpieces(design, exportSide, profile)
            .then((next) => {
                if (!live) return;
                setParts(next);
                setLoading(false);
            })
            .catch(() => {
                if (!live) return;
                setParts([]);
                setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [design, exportSide, profile]);

    return { parts, loading };
}
