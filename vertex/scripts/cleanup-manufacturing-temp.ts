// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * TTL cleanup for orphaned manufacturing STL uploads in `manufacturing-temp/`.
 *
 * Usage:
 *   cd vertex && npx tsx scripts/cleanup-manufacturing-temp.ts
 *
 * Scheduling (no Supabase Edge Functions in this repo — run via cron on the Node host):
 *   0 9 * * * cd /path/to/vertex && npx tsx scripts/cleanup-manufacturing-temp.ts >> /var/log/vertex-mfg-cleanup.log 2>&1
 *
 * Tradeoff vs Supabase Edge Function + pg_cron: this script reuses the existing Node
 * service-role Supabase client and deploys with the Vertex server — no separate Deno
 * function bundle or pg_net wiring. Requires a host that can reach Supabase Storage.
 *
 * Optional env:
 *   MANUFACTURING_TEMP_MAX_AGE_HOURS=48  (default 48)
 */

import { getSupabaseAdmin } from "../server/src/context";
import { cleanupManufacturingTempObjects } from "../server/src/lib/manufacturing-stl-lifecycle";

async function main() {
    const maxAgeHours = Number(process.env.MANUFACTURING_TEMP_MAX_AGE_HOURS ?? "48");
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        console.error("[cleanup-manufacturing-temp] SUPABASE not configured — aborting");
        process.exit(1);
    }

    console.log(`[cleanup-manufacturing-temp] scanning manufacturing-temp/ (max age ${maxAgeHours}h)`);
    const summary = await cleanupManufacturingTempObjects(supabase, maxAgeHours);
    console.log("[cleanup-manufacturing-temp] done", summary);
    if (summary.errors.length > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error("[cleanup-manufacturing-temp] fatal", err);
    process.exit(1);
});
