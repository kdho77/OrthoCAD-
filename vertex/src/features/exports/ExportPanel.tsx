import { Download, FileCode2, Lock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { exportDesign } from "@/features/exports/export-service";
import { useAuthStore } from "@/stores/auth-store";
import type { Side } from "@/types";

export function ExportPanel() {
    const { user, license } = useAuthStore();
    const [status, setStatus] = useState<string | null>(null);
    const [side, setSide] = useState<Side>("left");

    const stlCheck = canExport(user, license, "stl");
    const gcodeCheck = canExport(user, license, "gcode");

    const handleStl = () => {
        const res = exportDesign("stl", side);
        setStatus(res.ok ? `Exported ${res.filename} (-${TOKEN_COST.stl} token)` : (res.reason ?? "Export failed"));
    };

    return (
        <div className="space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-2 text-xs">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Token balance</span>
                    <span className="tabular-nums">{user?.tokenBalance ?? 0}</span>
                </div>
                <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">License</span>
                    <span>{license?.status ?? "none"}</span>
                </div>
            </div>

            <div className="flex gap-1">
                {(["left", "right"] as Side[]).map((s) => (
                    <Button key={s} size="sm" variant={side === s ? "default" : "secondary"} className="h-8 flex-1" onClick={() => setSide(s)}>
                        {s} insole
                    </Button>
                ))}
            </div>

            <Button className="w-full" disabled={!stlCheck.ok} onClick={handleStl}>
                {stlCheck.ok ? <Download className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                Export STL · {TOKEN_COST.stl} token
            </Button>
            {!stlCheck.ok ? <p className="text-xs text-amber-400">{stlCheck.reason}</p> : null}

            <Button className="w-full" variant="secondary" disabled title="Phase 3">
                <FileCode2 className="h-4 w-4" />
                Export G-code · {TOKEN_COST.gcode} tokens
            </Button>
            <p className="text-xs text-muted-foreground">
                {gcodeCheck.ok ? "Slicing & G-code arrive in Phase 3 (Kiri:Moto)." : `G-code locked: ${gcodeCheck.reason}`}
            </p>

            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}
        </div>
    );
}
