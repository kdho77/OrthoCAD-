// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { TRPCError } from "@trpc/server";
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
import {
    createSlicerCheckout,
    liveSlicerStripe,
    publicPayError,
    type SlicerPayEnv,
    type SlicerStripe,
    sealSliceFiles,
    slicerUnitAmountCents,
    stripeConfigured,
    unlockSlicerDownload,
} from "./slicer-pay.js";
import { sliceWithVertexSlice } from "./vertexslice-client.js";
import { createMockVertexSliceClient, type VertexSliceClient } from "./vertexslice-mock.js";

export const SLICER_REQUEST_ID_HEADER = "X-Request-Id";

export interface SlicerProxyEnv extends SlicerPayEnv {
    VERTEXSLICE_SLICER_URL?: string;
    VERTEXSLICE_API_KEY?: string;
    SLICER_MOCK?: string;
}

export function shouldUseMockSlicer(env: SlicerProxyEnv = process.env): boolean {
    const mockFlag = (env.SLICER_MOCK ?? "").trim();
    if (mockFlag === "1" || mockFlag.toLowerCase() === "true") return true;
    const url = (env.VERTEXSLICE_SLICER_URL ?? "").trim();
    const key = (env.VERTEXSLICE_API_KEY ?? "").trim();
    return url.length === 0 || key.length === 0;
}

async function modelToBytes(model: VertexSliceSliceInput["model"]): Promise<Uint8Array> {
    if (model instanceof Uint8Array) return model;
    if (model instanceof ArrayBuffer) return new Uint8Array(model);
    if (typeof Blob !== "undefined" && model instanceof Blob) {
        return new Uint8Array(await model.arrayBuffer());
    }
    return new Uint8Array();
}

function mapLiveSliceError(err: unknown): VertexSliceHttpError {
    if (err instanceof VertexSliceHttpError) return err;
    if (err instanceof TRPCError) {
        const status = err.code === "BAD_REQUEST" ? 400 : err.code === "UNAUTHORIZED" ? 401 : 502;
        return new VertexSliceHttpError(status, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("VertexSlice timed out")) return new VertexSliceHttpError(504, message);
    return new VertexSliceHttpError(502, message);
}

/** Live path. Uses the export VertexSlice client and the same server env. */
export function createLiveVertexSliceClient(): VertexSliceClient {
    return {
        async health() {
            throw new VertexSliceHttpError(501, "Unsupported");
        },
        async materials() {
            throw new VertexSliceHttpError(501, "Unsupported");
        },
        async profiles() {
            throw new VertexSliceHttpError(501, "Unsupported");
        },
        async slice(input, init) {
            if (init?.signal?.aborted) throw new VertexSliceHttpError(504, "Slice cancelled.");
            const model = await modelToBytes(input.model);
            const infillRaw =
                input.infillDensity == null || String(input.infillDensity).trim() === ""
                    ? undefined
                    : Number(String(input.infillDensity).replace(/%$/, ""));
            const wallRaw =
                input.wallLoops == null || String(input.wallLoops).trim() === ""
                    ? undefined
                    : Number(input.wallLoops);
            try {
                const gcode = await sliceWithVertexSlice({
                    profileId: input.profileId || DEFAULT_PROFILE_ID,
                    material: input.material || "apex_core",
                    model,
                    filename: input.filename,
                    infillDensityPct:
                        infillRaw !== undefined && Number.isInteger(infillRaw) ? infillRaw : undefined,
                    wallLoops: wallRaw !== undefined && Number.isInteger(wallRaw) ? wallRaw : undefined,
                    printDirection:
                        input.printDirection != null && String(input.printDirection).trim() !== ""
                            ? String(input.printDirection)
                            : undefined,
                    beltInsolePlace: input.beltInsolePlace,
                    preserveUploadedMesh: true,
                });
                return {
                    gcode,
                    status: 200,
                    headers: {
                        sliceSeconds: "",
                        peakRssKb: "",
                        profileId: input.profileId || DEFAULT_PROFILE_ID,
                        material: String(input.material || "apex_core"),
                        ...(wallRaw != null ? { wallLoops: String(wallRaw) } : {}),
                        ...(input.printDirection ? { printDirection: String(input.printDirection) } : {}),
                    },
                };
            } catch (err) {
                throw mapLiveSliceError(err);
            }
        },
    };
}

export function createSlicerBackend(env: SlicerProxyEnv = process.env): {
    client: VertexSliceClient;
    mock: boolean;
} {
    if (shouldUseMockSlicer(env)) {
        return { client: createMockVertexSliceClient(), mock: true };
    }
    return { client: createLiveVertexSliceClient(), mock: false };
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

async function authorize(request: Request): Promise<{ id: string; email: string; role: string } | null> {
    const ctx = await createFetchContext({
        req: request,
        resHeaders: new Headers(),
    } as unknown as Parameters<typeof createFetchContext>[0]);
    if (ctx.user?.id && ctx.user.email) {
        return { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role };
    }
    // Pay-per-file: slice is allowed without an account. Pay is not.
    return null;
}

function payEnv(env: SlicerProxyEnv | undefined): SlicerProxyEnv {
    return env ?? process.env;
}

function resolveStripe(env: SlicerProxyEnv, stripe?: SlicerStripe): SlicerStripe | null {
    if (!stripeConfigured(env)) return null;
    if (stripe) return stripe;
    return liveSlicerStripe(env);
}

function checkoutReturnUrls(request: Request): { successUrl: string; cancelUrl: string } | { error: string } {
    const headerOrigin = request.headers.get("origin");
    const fallback = (() => {
        try {
            return new URL(request.url).origin;
        } catch {
            return "";
        }
    })();
    const origin = headerOrigin || fallback;
    if (!origin) return { error: "Missing Origin" };
    let parsed: URL;
    try {
        parsed = new URL(origin);
    } catch {
        return { error: "Bad Origin" };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { error: "Bad Origin" };
    return {
        successUrl: `${parsed.origin}/slicer/checkout-return?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${parsed.origin}/slicer?checkout=cancelled`,
    };
}

async function handlePayAction(
    request: Request,
    action: "checkout" | "download",
    id: string,
    env: SlicerProxyEnv,
    stripe: SlicerStripe | null,
): Promise<Response> {
    const user = await authorize(request).catch(() => null);
    if (!user) {
        return jsonResponse({ ok: false, error: "Sign in to pay." }, 401, id, request);
    }
    let body: Record<string, unknown> = {};
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        return jsonResponse({ ok: false, error: "Expected JSON." }, 400, id, request);
    }

    if (action === "checkout") {
        const seals = Array.isArray(body.seals)
            ? body.seals.filter((item): item is string => typeof item === "string")
            : [];
        const urls = checkoutReturnUrls(request);
        if ("error" in urls) {
            return jsonResponse({ ok: false, error: urls.error }, 400, id, request);
        }
        const result = await createSlicerCheckout({
            stripe,
            user,
            seals,
            successUrl: urls.successUrl,
            cancelUrl: urls.cancelUrl,
            env,
        });
        if (!result.ok) return jsonResponse(result, 400, id, request);
        return jsonResponse(result, 200, id, request);
    }

    const sealed = typeof body.sealed === "string" ? body.sealed : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const result = await unlockSlicerDownload({ stripe, user, sealed, sessionId, env });
    if (!result.ok) return jsonResponse(result, 402, id, request);
    return jsonResponse({ ok: true, files: result.files }, 200, id, request);
}

export async function handleSlicerRequest(
    request: Request,
    deps?: { client?: VertexSliceClient; env?: SlicerProxyEnv; stripe?: SlicerStripe },
): Promise<Response> {
    const id = request.headers.get(SLICER_REQUEST_ID_HEADER) || requestId();
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET") {
        const env = payEnv(deps?.env);
        const mock = shouldUseMockSlicer(env);
        let unitAmountCents: number;
        try {
            unitAmountCents = slicerUnitAmountCents(env);
        } catch (err) {
            return jsonResponse(
                { ok: false, error: publicPayError(err, env.STRIPE_SECRET_KEY) },
                500,
                id,
                request,
            );
        }
        return jsonResponse(
            {
                ok: true,
                mock,
                payMock: !stripeConfigured(env),
                service: "orthocad-vertexslice-proxy",
                unitAmountCents,
                priceUsdPerFile: unitAmountCents / 100,
            },
            200,
            id,
            request,
        );
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

    const env = payEnv(deps?.env);
    const action = new URL(request.url).searchParams.get("action");
    if (action === "checkout" || action === "download") {
        try {
            return await handlePayAction(request, action, id, env, resolveStripe(env, deps?.stripe));
        } catch (err) {
            return jsonResponse(
                { ok: false, error: publicPayError(err, env.STRIPE_SECRET_KEY) },
                500,
                id,
                request,
            );
        }
    }

    try {
        await authorize(request);
    } catch {
        // Anonymous pay-per-file slice still proceeds; nothing is persisted.
    }

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
        const stats = parseGcodeStats(result.gcode);
        const sealed = sealSliceFiles([{ filename, gcode: result.gcode }], env);

        return jsonResponse(
            {
                ok: true,
                mock: backend.mock,
                sealed,
                headers: result.headers,
                stats,
                filename,
                requestId: id,
                toolpaths: null,
                layers: stats.layers,
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
