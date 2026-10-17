// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminAuditEntry, TenantRecord } from "../../../shared/admin/admin-domain";
import { AuditTable } from "./AdminTenantDetailPage";

interface AdminAuditPageProps {
    rows: AdminAuditEntry[];
    tenants: TenantRecord[];
    onExport: () => Promise<string>;
}

export function AdminAuditPage({ rows, tenants, onExport }: AdminAuditPageProps) {
    const [tenantId, setTenantId] = useState("");
    const [action, setAction] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");

    const filtered = useMemo(() => {
        return rows.filter((row) => {
            if (tenantId && row.tenantId !== tenantId) return false;
            if (action && !row.action.includes(action)) return false;
            if (from && row.createdAt < new Date(`${from}T00:00:00.000Z`).toISOString()) return false;
            if (to && row.createdAt > new Date(`${to}T23:59:59.000Z`).toISOString()) return false;
            return true;
        });
    }, [action, from, rows, tenantId, to]);

    return (
        <div className="mx-auto w-full max-w-6xl space-y-4 p-6">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold">Audit log</h1>
                    <p className="text-xs text-muted-foreground">
                        Immutable. Every write has a reason and a before → after diff.
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                        const csv = await onExport();
                        const blob = new Blob([csv], { type: "text/csv" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "admin-audit.csv";
                        a.click();
                        URL.revokeObjectURL(url);
                    }}
                >
                    <Download className="h-3.5 w-3.5" /> CSV export
                </Button>
            </div>
            <div className="flex flex-wrap gap-2">
                <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                >
                    <option value="">All tenants</option>
                    {tenants.map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name}
                        </option>
                    ))}
                </select>
                <Input
                    className="w-48"
                    placeholder="Action contains…"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                />
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <AuditTable rows={filtered} />
        </div>
    );
}
