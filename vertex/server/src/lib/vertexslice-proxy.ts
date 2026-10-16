// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    DEFAULT_PROFILE_ID,
    SLICE_FORM_FIELDS,
    VERTEXSLICE_MAX_UPLOAD_BYTES,
    type VertexSliceSliceInput,
} from "../../../shared/vertexslice/contract.js";
import { mapVertexSliceError, VertexSliceHttpError } from "../../../shared/vertexslice/errors.js";
import { slicerDownloadFilename } from "../../../shared/vertexslice/filename.js";
import { parseGcodeStats } from "../../../shared/vertexslice/gcode-stats.js";
import { createFetchContext } from "../context.js";
import { assertActiveLicense, requireSupabaseAdmin } from "./supabase-db.js";
import { createVertexSliceClient, type VertexSliceClient } from "./vertexslice-client.js";
import { createMockVertexSliceClient } from "./vertexslice-mock.js";

export const SLICER_REQUEST_ID_HEADER = "X-Request-Id";

export interface SlicerProxyEnv {
    VERTEXSLICE_URL?: string;
    VERTEXSLICE_API_KEY?: string;
    SLICER_MOCK?: string;
}

export function shouldUseMockSlicer(env: SlicerProxyEnv = process.env): boolean {
    const mockFlag = (env.SLICER_MOCK ?? "").trim();
    if (mockFlag === "1" || mockFlag.toLowerCase() === "true") return true;
    const url = (env.VERTEXSLICE_URL ?? "").trim();
    return url.length === 0;
}

export function createSlicerBackend(env: SlicerProxyEnv = process.env): {
    client: VertexSliceClient;
    mock: boolean;
} {
    if (shouldUseMockSlicer(env)) {
        return { client: createMockVertexSliceClient(), mock: true };
    }
    return {
        client: createVertexSliceClient({
            baseUrl: env.VERTEXSLICE_URL as string,
            apiKey: (env.VERTEXSLICE_API_KEY ?? "").trim(),
        }),
        mock: false,
    };
}

function requestId(): string {
    return crypto.randomUUID();
}

function corsHeaders(origin: string | null): Record<string, string> {
    const allow = process.env.CORS_ORIGIN ?? origin ?? "*";
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Slicer-Fault",
        "Access-Control-Expose-Headers": SLICER_REQUEST_ID_HEADER,
    };
}

function jsonResponse(body: unknown, status: number, id: string, request: Request): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json",
            [SLICER_REQUEST_ID_HEADER]: id,
            ...corsHeaders(request.headers.get("origin")),
        },
    });
}

function faultFromRequest(request: Request, formFault?: string | null): string | null {
    const urlFault = new URL(request.url).searchParams.get("fault");
    const headerFault = request.headers.get("X-Slicer-Fault");
    return urlFault || headerFault || formFault || null;
}

async function parseSliceInput(request: Request): Promise<{
    input: VertexSliceSliceInput;
    fault: string | null;
}> {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        const body = (await request.json()) as Record<string, unknown>;
        const modelB64 = typeof body.modelBase64 === "string" ? body.modelBase64 : "";
        const bytes = Uint8Array.from(Buffer.from(modelB64, "base64"));
        return {
            input: {
                profileId: String(body.profile_id ?? body.profileId ?? DEFAULT_PROFILE_ID),
                model: bytes,
                filename: typeof body.filename === "string" ? body.filename : "model.stl",
                wallLoops: body.wall_loops as string | number | null | undefined,
                infillDensity: body.infill_density as string | number | null | undefined,
                printDirection: body.print_direction as string | null | undefined,
                beltInsolePlace: body.belt_insole_place as boolean | undefined,
                material: body.material as string | null | undefined,
            },
            fault: typeof body.fault === "string" ? body.fault : null,
        };
    }

    const form = await request.formData();
    const file = form.get(SLICE_FORM_FIELDS.model);
    if (!(file instanceof Blob) || file.size === 0) {
        throw new VertexSliceHttpError(400, "model file is required");
    }
    if (file.size > VERTEXSLICE_MAX_UPLOAD_BYTES) {
        throw new VertexSliceHttpError(413, "Upload too large");
    }
    const filename =
        (file instanceof File && file.name) ||
        (typeof form.get("filename") === "string" ? (form.get("filename") as string) : "model.stl");
    const beltRaw = form.get(SLICE_FORM_FIELDS.beltInsolePlace);
    const beltInsolePlace =
        beltRaw == null ? true : String(beltRaw).toLowerCase() === "true" || String(beltRaw) === "1";
    return {
        input: {
            profileId: String(form.get(SLICE_FORM_FIELDS.profileId) || DEFAULT_PROFILE_ID),
            model: file,
            filename,
            wallLoops: (form.get(SLICE_FORM_FIELDS.wallLoops) as string | null) ?? null,
            infillDensity: (form.get(SLICE_FORM_FIELDS.infillDensity) as string | null) ?? null,
            printDirection: (form.get(SLICE_FORM_FIELDS.printDirection) as string | null) ?? null,
            beltInsolePlace,
            material: (form.get(SLICE_FORM_FIELDS.material) as string | null) ?? null,
        },
        fault: typeof form.get("fault") === "string" ? (form.get("fault") as string) : null,
    };
}

async function authorize(request: Request): Promise<{ id: string; role: string } | Response | null> {
    const ctx = await createFetchContext({
        req: request,
        resHeaders: new Headers(),
    } as unknown as Parameters<typeof createFetchContext>[0]);
    if (ctx.user) return { id: ctx.user.id, role: ctx.user.role };

    const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseConfigured) return null;
    return jsonResponse(
        {
            ok: false,
            error: {
                code: "unauthorized",
                cause: "Sign in to slice.",
                nextStep: "Sign in, then try again.",
                requestId: request.headers.get(SLICER_REQUEST_ID_HEADER) || "",
            },
        },
        401,
        request.headers.get(SLICER_REQUEST_ID_HEADER) || requestId(),
        request,
    );
}

async function assertLicenseUnlessSuperAdmin(user: { id: string; role: string } | null): Promise<void> {
    if (!user) return;
    if (user.role === "super_admin") return;
    const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseConfigured) return;
    const supabase = requireSupabaseAdmin();
    await assertActiveLicense(supabase, user.id);
}

export async function handleSlicerRequest(
    request: Request,
    deps?: { client?: VertexSliceClient; env?: SlicerProxyEnv },
): Promise<Response> {
    const id = request.headers.get(SLICER_REQUEST_ID_HEADER) || requestId();
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET") {
        const mock = shouldUseMockSlicer(deps?.env ?? process.env);
        return jsonResponse({ ok: true, mock, service: "orthocad-vertexslice-proxy" }, 200, id, request);
    }

    if (request.method !== "POST") {
        return jsonResponse(
            {
                ok: false,
                error: {
                    code: "validation",
                    cause: "Method not allowed",
                    nextStep: "POST a model.",
                    requestId: id,
                },
            },
            405,
            id,
            request,
        );
    }

    const auth = await authorize(request);
    if (auth instanceof Response) {
        const body = await auth.text();
        return new Response(body, {
            status: auth.status,
            headers: { ...Object.fromEntries(auth.headers), [SLICER_REQUEST_ID_HEADER]: id },
        });
    }

    try {
        await assertLicenseUnlessSuperAdmin(auth);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("No valid license") || message.includes("FORBIDDEN")) {
            return jsonResponse(
                {
                    ok: false,
                    error: {
                        code: "unauthorized",
                        cause: "No valid license.",
                        nextStep: "Ask an admin to assign a license, then try again.",
                        requestId: id,
                    },
                },
                403,
                id,
                request,
            );
        }
        return jsonResponse(
            {
                ok: false,
                error: mapVertexSliceError(500, message, id),
            },
            502,
            id,
            request,
        );
    }

    const env = deps?.env ?? process.env;
    const backend = deps?.client
        ? { client: deps.client, mock: shouldUseMockSlicer(env) }
        : createSlicerBackend(env);

    try {
        const parsed = await parseSliceInput(request);
        const fault = faultFromRequest(request, parsed.fault);
        const client = backend.mock && fault ? createMockVertexSliceClient({}, () => fault) : backend.client;
        const result = await client.slice(parsed.input, { signal: request.signal });

        const material = (result.headers.material || parsed.input.material || "apex_core") as
            | "apex_core"
            | "apex_light"
            | "apex_forge"
            | "apex_bounce";
        const printDirection = (result.headers.printDirection ||
            parsed.input.printDirection ||
            "toe_first") as "toe_first" | "heel_first";
        const wallLoops = Number(result.headers.wallLoops || parsed.input.wallLoops || 1);
        const filename = slicerDownloadFilename({
            modelName: parsed.input.filename || "model.stl",
            material: ["apex_core", "apex_light", "apex_forge", "apex_bounce"].includes(material)
                ? material
                : "apex_core",
            printDirection: printDirection === "heel_first" ? "heel_first" : "toe_first",
            wallLoops: Number.isFinite(wallLoops) ? wallLoops : 1,
        });

        return jsonResponse(
            {
                ok: true,
                mock: backend.mock,
                gcode: result.gcode,
                headers: result.headers,
                stats: parseGcodeStats(result.gcode),
                filename,
                requestId: id,
                toolpaths: null,
                layers: parseGcodeStats(result.gcode).layers,
            },
            200,
            id,
            request,
        );
    } catch (err) {
        if (request.signal.aborted) {
            return jsonResponse(
                {
                    ok: false,
                    error: {
                        code: "timeout",
                        cause: "Slice cancelled.",
                        nextStep: "Slice again when you are ready.",
                        requestId: id,
                    },
                },
                499,
                id,
                request,
            );
        }
        if (err instanceof VertexSliceHttpError) {
            const mapped = mapVertexSliceError(err.status, err.detail, id);
            const status =
                mapped.code === "timeout"
                    ? 504
                    : mapped.code === "server_busy"
                      ? 503
                      : mapped.code === "payload_too_large"
                        ? 413
                        : mapped.code === "validation" || mapped.code === "bad_mesh"
                          ? 400
                          : mapped.code === "unauthorized"
                            ? 401
                            : 502;
            return jsonResponse({ ok: false, error: mapped }, status, id, request);
        }
        const message = err instanceof Error ? err.message : String(err);
        return jsonResponse({ ok: false, error: mapVertexSliceError(500, message, id) }, 502, id, request);
    }
}

export function isSlicerProxyPath(pathname: string): boolean {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    return normalized === "/api/slicer" || normalized === "/slicer-api";
}

export async function incomingMessageToRequest(req: {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    [Symbol.asyncIterator]?: () => AsyncIterableIterator<Buffer | string>;
}): Promise<Request> {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
    const host = (req.headers.host as string | undefined) ?? "localhost";
    const path = req.url ?? "/";
    const url = `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    const chunks: Buffer[] = [];
    if (req[Symbol.asyncIterator]) {
        for await (const chunk of req as AsyncIterable<Buffer | string>) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
    }
    const raw = Buffer.concat(chunks);
    let body: Uint8Array | undefined;
    if (req.method !== "GET" && req.method !== "HEAD" && raw.length > 0) {
        body = new Uint8Array(raw.length);
        body.set(raw);
    }
    return new Request(url, { method: req.method, headers, body });
}

export async function sendFetchResponse(
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: Buffer) => void },
    response: Response,
): Promise<void> {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower === "content-length" || lower === "content-encoding") return;
        res.setHeader(key, value);
    });
    res.end(Buffer.from(await response.arrayBuffer()));
}
