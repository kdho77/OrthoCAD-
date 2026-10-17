// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    formatSlicerPriceUsd,
    isSlicerPayMock,
    type SlicerPaymentStatus,
} from "@/features/slicer/slicer-pay";
import { cn } from "@/lib/utils";
import type { SlicerPublicError } from "../../../shared/vertexslice/errors";
import { formatPrintTime } from "../../../shared/vertexslice/gcode-stats";
import type { SliceResult } from "./slicer-state";

export function ResultPanel({
    stateStatus,
    error,
    result,
    paymentStatus,
    paymentError,
    copied,
    onCopy,
    onRetry,
    onSliceAnother,
    onPay,
    onDownload,
}: {
    stateStatus: string;
    error: SlicerPublicError | null;
    result: SliceResult | null;
    paymentStatus: SlicerPaymentStatus;
    paymentError: string | null;
    copied: boolean;
    onCopy: (id: string) => void;
    onRetry: () => void;
    onSliceAnother: () => void;
    onPay: () => void;
    onDownload: () => void;
}) {
    if (stateStatus === "error" && error) {
        return (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                <h3 className="text-sm font-medium text-destructive">Couldn’t slice</h3>
                <p className="mt-1 text-sm">{error.cause}</p>
                <p className="mt-1 text-xs text-muted-foreground">{error.nextStep}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" onClick={onRetry}>
                        Retry
                    </Button>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        {error.requestId || "—"}
                    </code>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(error.requestId)}>
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        Copy ID
                    </Button>
                </div>
            </div>
        );
    }
    if ((stateStatus === "done" || stateStatus === "outdated") && result) {
        const stale = stateStatus === "outdated";
        return (
            <div className={cn("rounded-lg border border-border bg-panel p-4", stale && "opacity-70")}>
                {stale ? (
                    <div className="mb-3 rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-200">
                        Out of date: Slice again
                    </div>
                ) : null}
                <h3 className="text-sm font-medium">Result</h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Print time</dt>
                    <dd>{formatPrintTime(result.stats.printTimeSeconds)}</dd>
                    <dt className="text-muted-foreground">Filament used</dt>
                    <dd>
                        {result.stats.filamentGrams != null
                            ? `${result.stats.filamentGrams.toFixed(1)} g`
                            : "—"}
                        {result.stats.filamentMeters != null
                            ? ` · ${result.stats.filamentMeters.toFixed(2)} m`
                            : ""}
                    </dd>
                    <dt className="text-muted-foreground">Layers</dt>
                    <dd>{result.stats.layers ?? "—"}</dd>
                    <dt className="text-muted-foreground">Summary</dt>
                    <dd>
                        {result.material === "apex_core"
                            ? "ApexCore"
                            : result.material === "apex_light"
                              ? "ApexLight"
                              : result.material === "apex_forge"
                                ? "ApexForge"
                                : "ApexBounce"}{" "}
                        · {result.printDirection === "toe_first" ? "Toe first" : "Heel first"} ·{" "}
                        {result.wallLoops} {result.wallLoops === 1 ? "wall" : "walls"}
                        {result.downloads.length > 1 ? ` · ${result.downloads.length} files` : ""}
                    </dd>
                </dl>
                <div className="mt-4 rounded-md border border-border bg-background p-3">
                    <p className="text-sm font-medium">Pay &amp; download G-code</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {formatSlicerPriceUsd(result.downloads.length)} · download unlocks after payment.
                        {isSlicerPayMock() ? " Stripe is not wired — this preview uses mock checkout." : ""}
                    </p>
                    {paymentError ? <p className="mt-2 text-xs text-destructive">{paymentError}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                        {paymentStatus === "paid" ? (
                            <Button type="button" onClick={onDownload}>
                                Download G-code
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                onClick={() => void onPay()}
                                disabled={paymentStatus === "paying"}
                            >
                                {paymentStatus === "paying" ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Paying…
                                    </>
                                ) : (
                                    `Pay ${formatSlicerPriceUsd(result.downloads.length)} & download`
                                )}
                            </Button>
                        )}
                        <Button type="button" variant="outline" onClick={onSliceAnother}>
                            Slice another
                        </Button>
                    </div>
                </div>
                {stale ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        Download still uses the previous settings (
                        {result.downloads.map((d) => d.filename).join(", ")}).
                    </p>
                ) : null}
            </div>
        );
    }
    return (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Slice to see print time and filament, then pay to download G-code.
        </div>
    );
}
