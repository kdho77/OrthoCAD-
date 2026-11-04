// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Binds the integration API to Postgres for the standalone server and Vercel.
// The upload signing key is read from the environment and is never logged.

import { randomBytes } from "node:crypto";

import { bindIntegrationHandler } from "./http.js";
import { createPrismaIntegrationStore } from "./prisma-store.js";

let bound = false;

export function ensureIntegrationProduction(): void {
    if (bound) return;
    bound = true;
    const configured = process.env.INTEGRATION_UPLOAD_SIGNING_KEY?.trim();
    bindIntegrationHandler({
        store: createPrismaIntegrationStore(),
        now: () => new Date(),
        uploadSigningKey:
            configured && configured.length > 0 ? configured : randomBytes(32).toString("base64url"),
        uploadBaseUrl:
            process.env.INTEGRATION_UPLOAD_BASE?.trim() || "https://storage.orthocad.invalid/integrations",
        appOrigin: process.env.ORTHOCAD_APP_ORIGIN?.trim() || "https://app.orthocad.invalid",
    });
}
