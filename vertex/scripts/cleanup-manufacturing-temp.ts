// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * TTL cleanup for short-lived manufacturing objects in `manufacturing-temp/` and `gcode/`.
 * Objects older than 24 hours are deleted. `manufacturing-archive/` is not touched.
 *
 * Trigger: there is no Supabase Edge Function or pg_cron job in this repo. A host cron
 * runs this Node script with the service-role client:
 *
 *   0 9 * * * cd /path/to/vertex && npx tsx scripts/cleanup-manufacturing-temp.ts >> /var/log/vertex-mfg-cleanup.log 2>&1
 *
 *   npm run cleanup:manufacturing-temp
 *
 * The same schedule covers G-code. UI downloads use a short-lived signed URL and rely
 * on this sweep to remove the object. Cad-operator G-code is also deleted when a
 * VertexOrders attach is confirmed; this sweep is the backstop.
 *
 * Optional env (capped at 24):
 *   MANUFACTURING_TEMP_MAX_AGE_HOURS=24
 *
 * Listing existing archive objects without deleting them is
 * `scripts/list-stored-manufacturing-files.ts`. That script is dry-run only.
 */

import { getSupabaseAdmin } from "../server/src/context";
import {
    cleanupManufacturingTempObjects,
    MANUFACTURING_SWEEP_MAX_AGE_HOURS,
} from "../server/src/lib/manufacturing-stl-lifecycle";
import { MANUFACTURING_BUCKET } from "../server/src/lib/storage";

async function main() {
    const requested = Number(
        process.env.MANUFACTURING_TEMP_MAX_AGE_HOURS ?? String(MANUFACTURING_SWEEP_MAX_AGE_HOURS),
    );
    const maxAgeHours = Number.isFinite(requested)
        ? Math.min(requested, MANUFACTURING_SWEEP_MAX_AGE_HOURS)
        : MANUFACTURING_SWEEP_MAX_AGE_HOURS;
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        console.error("[cleanup-manufacturing-temp] SUPABASE not configured — aborting");
        process.exit(1);
    }

    console.log(
        `[cleanup-manufacturing-temp] scanning manufacturing-temp/ and gcode/ in ${MANUFACTURING_BUCKET} (max age ${maxAgeHours}h)`,
    );
    const summary = await cleanupManufacturingTempObjects(supabase, maxAgeHours, MANUFACTURING_BUCKET);
    console.log("[cleanup-manufacturing-temp] done", summary);
    if (summary.errors.length > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error("[cleanup-manufacturing-temp] fatal", err);
    process.exit(1);
});
