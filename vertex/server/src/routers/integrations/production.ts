// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Binds the integration API to Postgres for the standalone server and Vercel.
// Scan upload URLs are signed PUTs on the existing STORAGE_BUCKET. The file body
// is never accepted by this process.

import { getSupabaseAdmin } from "../../context.js";
import { bindIntegrationHandler } from "./http.js";
import { createPrismaIntegrationStore } from "./prisma-store.js";

let bound = false;

export function ensureIntegrationProduction(): void {
    if (bound) return;
    bound = true;
    bindIntegrationHandler({
        store: createPrismaIntegrationStore(),
        now: () => new Date(),
        supabase: getSupabaseAdmin(),
        appOrigin: process.env.ORTHOCAD_APP_ORIGIN?.trim() || "https://app.orthocad.invalid",
    });
}
