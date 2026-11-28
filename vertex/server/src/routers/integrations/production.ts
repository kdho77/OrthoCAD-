// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Binds the integration API to Postgres for the standalone server and Vercel.
// Scan upload targets come from Supabase scan storage. Missing storage env
// is a logged config error. This module never returns a placeholder upload host.

import { randomBytes } from "node:crypto";

import { createHandoffScanUploadTarget } from "../../lib/scan-upload-target.js";
import { bindIntegrationHandler } from "./http.js";
import { createPrismaIntegrationStore } from "./prisma-store.js";

let bound = false;

function logHandoff(event: string, fields: Record<string, string | number>): void {
    console.error(JSON.stringify({ source: "orthocad-handoff", event, ...fields }));
}

export function ensureIntegrationProduction(): void {
    if (bound) return;
    bound = true;
    const configured = process.env.INTEGRATION_UPLOAD_SIGNING_KEY?.trim();
    bindIntegrationHandler({
        store: createPrismaIntegrationStore(),
        now: () => new Date(),
        uploadSigningKey:
            configured && configured.length > 0 ? configured : randomBytes(32).toString("base64url"),
        // Unused for scan bytes. The signed URL comes from scan storage.
        uploadBaseUrl: "",
        appOrigin: process.env.ORTHOCAD_APP_ORIGIN?.trim() || "https://app.orthocad.invalid",
        createScanUploadTarget: (input) => createHandoffScanUploadTarget(input),
        log: logHandoff,
    });
}
