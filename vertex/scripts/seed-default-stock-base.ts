// Example bootstrap / admin seed script for the canonical system default stock base.
//
// Usage (with a service/admin token or direct DB access):
//   tsx vertex/scripts/seed-default-stock-base.ts
//
// This is intentionally simple. In real deployments you would usually:
//   1. Pre-place the GLB file in your STOCK_BUCKET (e.g. stock/standard/Default.glb)
//   2. Run this (or an equivalent admin mutation call) to ensure the DB row exists
//      with isDefault=true and isActive=true.
//
// The ensureDefaultStockBase admin mutation (exposed to admins) is the
// preferred runtime way to (re)seed after the initial deploy.

import { getSupabaseAdmin } from "../server/src/context";
import { prisma } from "../server/src/context";
import { buildStockGlbKey, uploadAsset } from "../server/src/lib/storage";
import { validateGlbBase64 } from "../server/src/lib/glb-validation";

// You can supply the GLB bytes via env (base64) for a true "upload on seed" experience,
// or leave it empty and just ensure the row (file must already be in storage).
const GLB_BASE64 = process.env.DEFAULT_STOCK_GLB_BASE64 ?? "";
const DESIRED_NAME = "Default Stock Base";
const CONVENTIONAL_GLB_PATH = "stock/standard/Default.glb";

async function main() {
    console.log("[seed] Ensuring canonical default stock base...");

    const supabase = getSupabaseAdmin();

    let glbPath = CONVENTIONAL_GLB_PATH;

    if (GLB_BASE64) {
        const validated = validateGlbBase64(GLB_BASE64);
        if (!validated.ok) {
            throw new Error(`Invalid GLB: ${validated.reason}`);
        }
        const key = buildStockGlbKey(DESIRED_NAME, { category: "standard" });
        if (supabase) {
            await uploadAsset(supabase, key, validated.bytes, "model/gltf-binary", process.env.STOCK_STORAGE_BUCKET);
            glbPath = key;
            console.log("[seed] Uploaded GLB to", key);
        }
    }

    // Idempotent upsert with the same single-default logic the admin mutation uses.
    const row = await prisma.$transaction(async (tx) => {
        await tx.stockBase.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
        });

        const existing = await tx.stockBase.findFirst({
            where: { name: DESIRED_NAME },
        });

        const meta = {
            isSystemDefault: true,
            seededBy: "script",
            seededAt: new Date().toISOString(),
        };

        if (existing) {
            return tx.stockBase.update({
                where: { id: existing.id },
                data: {
                    isDefault: true,
                    isActive: true,
                    glbPath,
                    metadata: meta,
                },
            });
        }

        return tx.stockBase.create({
            data: {
                name: DESIRED_NAME,
                glbPath,
                primarySide: "right",
                isDefault: true,
                isActive: true,
                metadata: meta,
            },
        });
    });

    console.log("[seed] Default stock base ready:", {
        id: row.id,
        name: row.name,
        glbPath: row.glbPath,
        isDefault: row.isDefault,
        isActive: row.isActive,
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});