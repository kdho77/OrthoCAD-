// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { devAuthHeaderValue } from "@/lib/dev-auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { VertexSliceMaterialId, VertexSlicePrintDirection } from "../../../shared/vertexslice/contract";
import { DEFAULT_PROFILE_ID, SLICE_FORM_FIELDS } from "../../../shared/vertexslice/contract";
import type { SlicerPublicError } from "../../../shared/vertexslice/errors";
import type { GcodeStats } from "../../../shared/vertexslice/gcode-stats";

export interface SliceProxySuccess {
    ok: true;
    mock: boolean;
    sealed: string;
    headers: {
        sliceSeconds: string;
        peakRssKb: string;
        profileId: string;
        material: string;
        wallLoops?: string;
        infillDensity?: string;
        printDirection?: string;
    };
    stats: GcodeStats;
    filename: string;
    requestId: string;
    toolpaths: null;
    layers: number | null;
}

export interface SliceProxyFailure {
    ok: false;
    error: SlicerPublicError;
}

export type SliceProxyResponse = SliceProxySuccess | SliceProxyFailure;

export interface SlicerQuote {
    ok: true;
    mock: boolean;
    payMock: boolean;
    unitAmountCents: number;
    priceUsdPerFile: number;
}

export interface SlicerCheckoutResult {
    ok: true;
    mock: boolean;
    sessionId: string;
    url?: string;
    unitAmountCents: number;
    fileCount: number;
}

export interface SliceProxyRequest {
    file: File;
    material: VertexSliceMaterialId;
    printDirection: VertexSlicePrintDirection;
    wallLoops: number;
    infillDensity: number;
    fault?: string | null;
    signal?: AbortSignal;
}

async function authHeader(): Promise<string | null> {
    const supabase = getSupabase();
    if (supabase) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) return `Bearer ${token}`;
    }
    if (!isSupabaseConfigured()) return `Bearer ${devAuthHeaderValue()}`;
    return null;
}

export async function requestSlice(input: SliceProxyRequest): Promise<SliceProxyResponse> {
    const form = new FormData();
    form.set(SLICE_FORM_FIELDS.profileId, DEFAULT_PROFILE_ID);
    form.set(SLICE_FORM_FIELDS.model, input.file, input.file.name);
    form.set(SLICE_FORM_FIELDS.wallLoops, String(input.wallLoops));
    form.set(SLICE_FORM_FIELDS.infillDensity, String(input.infillDensity));
    form.set(SLICE_FORM_FIELDS.printDirection, input.printDirection);
    form.set(SLICE_FORM_FIELDS.beltInsolePlace, "true");
    form.set(SLICE_FORM_FIELDS.material, input.material);
    if (input.fault) form.set("fault", input.fault);

    const headers: Record<string, string> = {};
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    if (input.fault) headers["X-Slicer-Fault"] = input.fault;

    const url = input.fault ? `/api/slicer?fault=${encodeURIComponent(input.fault)}` : "/api/slicer";
    const res = await fetch(url, { method: "POST", body: form, headers, signal: input.signal });
    const json = (await res.json().catch(() => null)) as SliceProxyResponse | null;
    if (json && typeof json === "object" && "ok" in json) return json;
    return {
        ok: false,
        error: {
            code: "auth_config",
            cause: "Something on our side. Try again; if it repeats, share this ID",
            nextStep: "Retry. If it happens again, send this request ID to support.",
            requestId: res.headers.get("X-Request-Id") || "",
        },
    };
}

export async function fetchSlicerQuote(): Promise<SlicerQuote | null> {
    const res = await fetch("/api/slicer");
    const json = (await res.json().catch(() => null)) as SlicerQuote | null;
    if (!json || json.ok !== true || typeof json.unitAmountCents !== "number") return null;
    return json;
}

export async function requestSlicerCheckout(
    seals: string[],
): Promise<SlicerCheckoutResult | { ok: false; error: string }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    const res = await fetch("/api/slicer?action=checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({ seals }),
    });
    const json = (await res.json().catch(() => null)) as
        | SlicerCheckoutResult
        | { ok: false; error: string }
        | null;
    if (json && typeof json === "object" && "ok" in json) return json;
    return { ok: false, error: "Checkout failed." };
}

export async function requestPaidGcode(
    sealed: string,
    sessionId: string,
): Promise<{ ok: true; gcode: string; filename: string } | { ok: false; error: string }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    const res = await fetch("/api/slicer?action=download", {
        method: "POST",
        headers,
        body: JSON.stringify({ sealed, sessionId }),
    });
    const json = (await res.json().catch(() => null)) as
        | { ok: true; files: Array<{ gcode: string; filename: string }> }
        | { ok: false; error: string }
        | null;
    if (json && "ok" in json && json.ok && json.files[0]) {
        return { ok: true, gcode: json.files[0].gcode, filename: json.files[0].filename };
    }
    if (json && "ok" in json && !json.ok) return { ok: false, error: json.error };
    return { ok: false, error: "Download is locked until payment is confirmed." };
}

export function downloadGcode(gcode: string, filename: string): void {
    const blob = new Blob([gcode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
