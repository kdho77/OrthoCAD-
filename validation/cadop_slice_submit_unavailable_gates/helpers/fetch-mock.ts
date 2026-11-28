// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

export type FetchCall = { url: string; init: RequestInit };

export function installFetch(
    handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): FetchCall[] {
    const calls: FetchCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const request = init ?? {};
        calls.push({ url, init: request });
        return handler(url, request);
    }) as typeof fetch;
    return calls;
}

export const ORIGINAL_FETCH = globalThis.fetch;

export function restoreFetch(): void {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.VERTEXSLICE_SLICER_URL;
    delete process.env.VERTEXSLICE_API_KEY;
}
