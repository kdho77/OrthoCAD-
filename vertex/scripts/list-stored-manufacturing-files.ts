// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Dry-run inventory of manufacturing objects that should not stay at rest.
 * Lists every manufacturing-archive object and manufacturing-temp / gcode objects
 * older than 24 hours. This script never deletes.
 *
 * Existing-file cleanup is a separate, approved step. Do not run `--confirm`
 * expecting a delete: the flag is accepted and the run still only lists.
 *
 *   cd vertex && npx tsx scripts/list-stored-manufacturing-files.ts
 *
 * The live delete sweep is `scripts/cleanup-manufacturing-temp.ts` (host cron).
 * It does not remove manufacturing-archive objects.
 */

import { getSupabaseAdmin } from "../server/src/context";
import {
    listStoredManufacturingFiles,
    MANUFACTURING_SWEEP_MAX_AGE_HOURS,
    storedManufacturingListPlan,
} from "../server/src/lib/manufacturing-stl-lifecycle";
import { MANUFACTURING_BUCKET } from "../server/src/lib/storage";

async function main() {
    const plan = storedManufacturingListPlan(process.argv.slice(2));
    if (plan.confirmRequested) {
        console.log(
            "[list-stored-manufacturing-files] --confirm was passed. Deletion is not implemented and was not run.",
        );
    }
    if (plan.deletes) {
        console.error("[list-stored-manufacturing-files] refusing to delete");
        process.exit(1);
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
        console.error("[list-stored-manufacturing-files] SUPABASE not configured — aborting");
        process.exit(1);
    }

    const inventory = await listStoredManufacturingFiles(
        supabase,
        MANUFACTURING_SWEEP_MAX_AGE_HOURS,
        MANUFACTURING_BUCKET,
    );
    console.log(
        JSON.stringify(
            {
                bucket: MANUFACTURING_BUCKET,
                deletes: plan.deletes,
                confirmRequested: plan.confirmRequested,
                manufacturingArchive: inventory.manufacturingArchive,
                staleManufacturingTemp: inventory.staleManufacturingTemp,
                staleGcode: inventory.staleGcode,
            },
            null,
            2,
        ),
    );
}

main().catch((err) => {
    console.error("[list-stored-manufacturing-files] fatal", err);
    process.exit(1);
});
