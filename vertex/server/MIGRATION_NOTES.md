# OrthoCAD Backend — prismaDirect → Supabase RPC Migration Notes

## Established migration pattern (from export.ts, ai.ts, manufacturing.ts)

### RPC call style
```typescript
const supabase = getSupabaseAdmin();
if (!supabase) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase admin client not configured" });
}
const { data, error } = await supabase.rpc("vertex_<operation_name>", {
    p_user_id: ctx.user.id,
    p_cost: cost,
    // snake_case p_* parameters matching SQL function args
});
if (error) {
    if (error.message.includes("INSUFFICIENT_TOKENS")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "..." });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `...: ${error.message}` });
}
const result = data as { ... };
```

### Error handling
- Business failures use `RAISE EXCEPTION 'INSUFFICIENT_TOKENS'` (or `NO_VALID_LICENSE`, `NOT_FOUND`) in SQL.
- TypeScript maps these via `error.message.includes("TOKEN")`.
- Unexpected RPC errors become `INTERNAL_SERVER_ERROR`.

### Naming convention
- Functions: `vertex_<verb>_<domain>` (e.g. `vertex_charge_library_save`, `vertex_save_design`).
- Parameters: `p_<snake_case>` prefix.
- Shared helpers: `vertex_deduct_user_tokens`, `vertex_assert_active_license`.

### TypeScript pattern
- Cast `data` to expected result shape after error check.
- No function signature changes on tRPC procedures.
- License/balance pre-checks may remain in application code for UX; atomic check-and-deduct lives in RPC.

## Remaining prismaDirect inventory (pre-Stream-B)

| File | Transaction blocks | Description |
|------|-------------------|-------------|
| manufacturing.ts | 0 (migrated) | `generateSolid` uses `vertex_charge_manufacturing_hybrid` RPC |
| library.ts | 1 | `deductSaveTokens`: atomic token deduct + token_transaction + audit_log |
| design.ts | 1 | `save`: design update + replace corrections/elements + audit_log |
| stock.ts | 4 | `createStockBase`, `updateStockBase`, `deleteStockBase`, `ensureDefaultStockBase` |

## SQL RPC functions (Stream B)

| Phase | File | Functions |
|-------|------|-----------|
| D | `supabase/rpcs/phase_d_manufacturing.sql` | `vertex_deduct_user_tokens`, `vertex_assert_active_license`, `vertex_charge_manufacturing_hybrid` |
| E | `supabase/rpcs/phase_e_library.sql` | `vertex_charge_library_save` |
| F | `supabase/rpcs/phase_f_design.sql` | `vertex_save_design` |
| G | `supabase/rpcs/phase_g_stock.sql` | `vertex_create_stock_base`, `vertex_update_stock_base`, `vertex_delete_stock_base`, `vertex_ensure_default_stock_base` |

Deploy order: phase_d (includes shared helpers) → phase_e → phase_f → phase_g.

Also deploy (from prior passes, not in repo until now): `vertex_authorize_export`, `vertex_charge_ai_prescription` — see git history commits `31ca5ddc`, `cd85a36c`.

## Supabase project / schema
- PostgreSQL via Supabase (`DATABASE_URL` pooled, `DIRECT_URL` direct).
- Prisma schema: `vertex/prisma/schema.prisma` — tables use `@@map` snake_case; columns use quoted camelCase.
- RPC functions run as `SECURITY DEFINER` with service-role caller from `getSupabaseAdmin()`.

## Risks
- **Token safety**: guarded `UPDATE ... WHERE tokenBalance >= cost` inside RPC only.
- **library.ts split**: GLB row created before token charge (pre-existing; not changed in this pass).
- **stock delete**: storage delete remains in TS (best-effort); DB promotion+delete is atomic in RPC.
- **admin.ts**: still uses prismaDirect (`grantTokens`) — out of Stream B scope.

## Surprises
- `manufacturing.ts` already migrated on `main` before Stream B; Phase D adds SQL file only.
- `admin.ts` listed as example in prompt but still uses prismaDirect on current `main`.
- `ensure-user.ts` uses prismaDirect upsert (out of scope).
- No RPC SQL files existed in repo prior to this pass — functions must be deployed manually in Supabase SQL editor.
