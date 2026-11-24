// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SliceStep } from "./slicer-state";

export const SLICER_SLOW_MS = 20_000;
export const SLICER_STEPS: SliceStep[] = ["Preparing", "Slicing", "Packaging"];

export function SliceButtonBar({
    status,
    sliceStep,
    slicingSlow,
    onSlice,
    onCancel,
    onKeepWaiting,
}: {
    status: string;
    sliceStep: SliceStep;
    slicingSlow: boolean;
    onSlice: () => void;
    onCancel: () => void;
    onKeepWaiting: () => void;
}) {
    const slicing = status === "slicing";
    return (
        <div className="space-y-2">
            <Button type="button" className="w-full" size="lg" onClick={onSlice}>
                {slicing ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Slicing… ~5 s
                    </>
                ) : (
                    "Slice"
                )}
            </Button>
            {slicing ? (
                <div className="text-center text-xs text-muted-foreground">
                    {SLICER_STEPS.map((step, i) => (
                        <span key={step}>
                            <span className={step === sliceStep ? "text-foreground" : ""}>{step}</span>
                            {i < SLICER_STEPS.length - 1 ? " → " : ""}
                        </span>
                    ))}
                </div>
            ) : null}
            {slicing ? (
                <div className="flex justify-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            ) : null}
            {slicing && slicingSlow ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    Taking longer than usual
                    <div className="mt-2 flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={onKeepWaiting}>
                            Keep waiting
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
